/* global DOMException:false */
import {
  promptSessionConstrainedWithRetry,
  checkContextBudget,
  getContextInfo,
  tokensToChars,
} from "./prompt-api.js";
import { formatToolResult } from "./tool-formatting.js";
import { debug } from "../util/debug.js";
import { config } from "../config.js";

/**
 * Trim a tool result string to fit within maxTokens without cutting mid-value.
 * If the result is JSON with a posts array, drop posts from the end instead
 * of slicing the string (which would break URLs and fields).
 */
const trimResult = (str, maxTokens) => {
  const maxChars = tokensToChars(maxTokens);
  if (str.length <= maxChars) return str;
  try {
    const obj = JSON.parse(str);
    if (obj && Array.isArray(obj.posts)) {
      while (obj.posts.length > 1) {
        obj.posts.pop();
        const attempt = JSON.stringify(obj);
        if (attempt.length <= maxChars) return attempt;
      }
      return JSON.stringify(obj);
    }
  } catch {
    // not JSON — fall through
  }
  return str.slice(0, maxChars) + "...[truncated]";
};

/**
 * Attempt to repair JSON truncated by output token limits.
 * Closes unterminated strings, then adds missing brackets/braces.
 */
const repairTruncatedJson = (raw) => {
  let s = raw;

  // If we're inside an unterminated string, close it
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
  }
  if (inString) s += '"';

  // Close any open brackets/braces
  const stack = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    if (ch === "}") stack.pop();
    if (ch === "]") stack.pop();
  }

  // Remove trailing comma before we close
  s = s.replace(/,\s*$/, "");

  while (stack.length > 0) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }

  return JSON.parse(s);
};

const mergeToolArgsSchema = (tools) => {
  // Combine all tool input schema properties so constrained decoding
  // knows which fields are valid inside tool_args.
  // Strip non-structural fields (description, etc.) that Chrome's
  // constrained decoding may not support.
  const properties = {};
  for (const t of tools) {
    const schema = t.inputSchema;
    if (schema && schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        const clean = { type: value.type };
        if (value.enum) clean.enum = value.enum;
        if (value.items) clean.items = { type: value.items.type };
        properties[key] = clean;
      }
    }
  }
  if (Object.keys(properties).length === 0) {
    return { type: "object" };
  }
  return { type: "object", properties };
};

const buildResponseSchema = (tools) => ({
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["tool_call", "final_answer"],
    },
    tool_name: {
      type: "string",
      enum: tools.map((t) => t.name),
    },
    tool_args: mergeToolArgsSchema(tools),
    text: { type: "string" },
  },
  required: ["action"],
});

/** Truncate text at the last newline before maxChars. */
const truncateAtLineBoundary = (text, maxChars) => {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  return (
    (cut > 0 ? text.slice(0, cut) : text.slice(0, maxChars)) +
    "\n...[truncated for retry]"
  );
};

/**
 * Halve tool result content in a message string for retry.
 * If the result is JSON with a `posts` array, drops posts from the end.
 * Otherwise falls back to line-boundary truncation.
 */
const halveToolResults = (message) => {
  return message.replace(
    /(Tool results:\n)([\s\S]*?)(\n\n)/g,
    (_, prefix, content, suffix) => {
      const budget = Math.ceil(content.length * config.context.retryReduction);
      // Try structure-aware truncation on <tool_result> tags
      const shortened = content.replace(
        /(<tool_result name="[^"]*">)([\s\S]*?)(<\/tool_result>)/g,
        (match, open, body, close) => {
          try {
            const obj = JSON.parse(body);
            if (obj && Array.isArray(obj.posts) && obj.posts.length > 1) {
              const keep = Math.max(1, Math.ceil(obj.posts.length * 0.5));
              obj.posts = obj.posts.slice(0, keep).map((p) => ({
                ...p,
                excerpt: p.excerpt ? p.excerpt.slice(0, 200) : p.excerpt,
              }));
              return open + JSON.stringify(obj) + close;
            }
          } catch {
            // not JSON with posts — fall through
          }
          // Line-boundary fallback for this tool_result
          const resultBudget = Math.ceil(
            body.length * config.context.retryReduction,
          );
          return open + truncateAtLineBoundary(body, resultBudget) + close;
        },
      );
      // If no <tool_result> tags were found, truncate the whole content block
      if (shortened === content) {
        return prefix + truncateAtLineBoundary(content, budget) + suffix;
      }
      return prefix + shortened + suffix;
    },
  );
};

/**
 * Manual tool-calling loop: constrained decoding → parse → execute → repeat.
 *
 * Future migration: when Chrome ships native tool support, the entire body
 * becomes `return session.prompt(message)` (tools already on session).
 */
export const runToolLoop = async (session, message, tools, options = {}) => {
  const {
    maxIterations = config.agents.maxIterations,
    maxResultTokens = config.agents.maxResultTokens || 1000,
    emit = () => {},
    agentName = "agent",
    onContextUpdate,
    signal,
  } = options;

  let effectiveMaxResultTokens = maxResultTokens;
  const responseConstraint = buildResponseSchema(tools);
  debug(
    agentName,
    "=== RESPONSE CONSTRAINT ===\n" +
      JSON.stringify(responseConstraint, null, 2),
  );

  let currentMessage = message;
  let lastResponse = "";
  const collectedUrls = new Set();

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const iterStart = Date.now();
    // Check context budget before prompting
    const budget = checkContextBudget(session, currentMessage);

    // Dynamic token budget based on available context
    const reserve = config.context.resultTokenReserve || 100;
    if (budget.available != null) {
      const dynamicBudget = Math.floor(budget.available * 0.5) - reserve;
      effectiveMaxResultTokens = Math.max(
        200,
        Math.min(maxResultTokens, dynamicBudget),
      );
    }

    if (budget.pct != null && budget.pct >= config.context.criticalPct) {
      debug.warn(
        agentName,
        `Context critical (${budget.pct}%), halving result token budget`,
      );
      effectiveMaxResultTokens = Math.floor(effectiveMaxResultTokens * 0.5);
    }

    debug(
      agentName,
      `Result token budget: ${effectiveMaxResultTokens} (available: ${budget.available}, cap: ${maxResultTokens})`,
    );

    emit("prompt", {
      summary: `Sending message (iteration ${i + 1})`,
      prompt: currentMessage,
    });
    debug(agentName, `=== INPUT (iteration ${i + 1}) ===\n` + currentMessage);

    let raw;
    try {
      raw = await promptSessionConstrainedWithRetry(
        session,
        currentMessage,
        responseConstraint,
        halveToolResults,
        (shorter) =>
          emit("prompt", {
            summary: `Retry with shortened context (iteration ${i + 1})`,
            prompt: shorter,
          }),
      );
      // Report context after successful prompt
      if (onContextUpdate) {
        const info = getContextInfo(session);
        if (info) onContextUpdate(info);
      }
    } catch (err) {
      if (err.message.includes("timed out")) {
        emit("retry", `Prompt timed out, retried with shorter context`);
      }
      emit("error", `Prompt failed: ${err.message}`);
      throw err;
    }

    debug(agentName, `=== RAW OUTPUT (iteration ${i + 1}) ===\n` + raw);

    let response;
    try {
      response = JSON.parse(raw);
    } catch (err) {
      debug(
        agentName,
        "JSON.parse failed, attempting truncation repair:",
        err.message,
      );
      try {
        response = repairTruncatedJson(raw);
        debug(agentName, "Truncation repair succeeded");
      } catch (repairErr) {
        debug(agentName, "Repair also failed:", repairErr.message);
        emit("error", `Invalid JSON from constrained decoding: ${err.message}`);
        lastResponse = raw;
        break;
      }
    }

    debug(
      agentName,
      `=== PARSED (iteration ${i + 1}) ===\n` +
        JSON.stringify(response, null, 2),
    );

    if (response.action === "final_answer") {
      lastResponse = response.text || "";
      emit("response", lastResponse);
      debug(agentName, "Final answer received, ending loop");
      debug.timing(`${agentName}:iter${i + 1}`, Date.now() - iterStart);
      break;
    }

    if (response.action === "tool_call") {
      const tc = { name: response.tool_name, args: response.tool_args || {} };
      emit("tool-call", { name: tc.name, args: tc.args });
      emit("response", `Calling tool: ${tc.name}`);
      debug(
        agentName,
        `=== CALLING TOOL: ${tc.name} ===\nArgs:`,
        JSON.stringify(tc.args, null, 2),
      );

      // Find the executable tool by name
      const tool = tools.find((t) => t.name === tc.name);
      if (!tool) {
        const errMsg = `Unknown tool: ${tc.name}`;
        debug(agentName, `=== TOOL ERROR: ${tc.name} ===\n` + errMsg);
        emit("tool-error", { name: tc.name, error: errMsg });
        currentMessage =
          "Tool results:\n" +
          formatToolResult(tc.name, { error: errMsg }) +
          "\n\nContinue based on these results.";
        continue;
      }

      let resultMessage;
      try {
        const t0 = Date.now();
        const resultStr = await tool.execute(tc.args);
        debug.timing(`tool:${tc.name}`, Date.now() - t0);
        // Collect URLs from raw result before trimming
        try {
          const parsed = JSON.parse(resultStr);
          if (parsed && Array.isArray(parsed.posts)) {
            for (const post of parsed.posts) {
              if (post.href) collectedUrls.add(post.href);
            }
          }
        } catch {
          /* not JSON with posts */
        }
        const trimmed = trimResult(resultStr, effectiveMaxResultTokens);
        debug(agentName, `=== TOOL RESULT: ${tc.name} ===\n` + trimmed);
        emit("tool-result", {
          name: tc.name,
          result: resultStr,
        });
        resultMessage = formatToolResult(tc.name, trimmed);
      } catch (err) {
        debug(agentName, `=== TOOL ERROR: ${tc.name} ===\n` + err.message);
        emit("tool-error", { name: tc.name, error: err.message });
        resultMessage = formatToolResult(tc.name, { error: err.message });
      }

      currentMessage =
        "Tool results:\n" +
        resultMessage +
        "\n\nUse ONLY the data above. Copy URLs exactly as shown — do not modify, complete, or invent any URL. If any value looks truncated, omit it. Continue based on these results.";
      lastResponse = response.text || "";
      debug.timing(`${agentName}:iter${i + 1}`, Date.now() - iterStart);
    }
  }

  return { text: lastResponse, validUrls: [...collectedUrls] };
};
