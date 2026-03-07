import { createSession, promptSessionConstrained } from "./prompt-api.js";
import { formatToolResult } from "./tool-call-parser.js";
import { callTool } from "../bridge/tool-registry.js";
import { debug } from "../util/debug.js";

const MAX_ITERATIONS = 3;
const MAX_SEARCH_POSTS = 8;

/**
 * Slim down search results to reduce context size for the local model.
 * Keeps only the fields the agents need (title, href, date) and caps post count.
 */
const slimToolResult = (result) => {
  if (result && typeof result === "object" && Array.isArray(result.posts)) {
    return {
      postCount: Math.min(result.posts.length, MAX_SEARCH_POSTS),
      posts: result.posts.slice(0, MAX_SEARCH_POSTS).map((p) => ({
        title: p.title,
        href: p.href,
        date: p.date,
      })),
    };
  }
  return result;
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

/**
 * Run an agent loop: prompt the model with constrained decoding,
 * parse the structured JSON response, execute tool calls,
 * feed results back, repeat until final_answer or max iterations.
 */
export const runAgentLoop = async ({
  systemPrompt,
  userMessage,
  tools,
  onActivity,
  agentName,
}) => {
  const emit = (type, detail) => {
    if (onActivity) {
      onActivity({
        agent: agentName,
        type,
        detail,
        timestamp: Date.now(),
      });
    }
  };

  emit("start", `${agentName} starting`);
  debug(agentName, "=== SYSTEM PROMPT ===\n" + systemPrompt);

  const session = await createSession(systemPrompt);
  const responseConstraint = buildResponseSchema(tools);
  debug(
    agentName,
    "=== RESPONSE CONSTRAINT ===\n" +
      JSON.stringify(responseConstraint, null, 2),
  );
  let currentMessage = userMessage;
  let lastResponse = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    emit("prompt", `Sending message (iteration ${i + 1})`);
    debug(agentName, `=== INPUT (iteration ${i + 1}) ===\n` + currentMessage);

    let raw;
    try {
      raw = await promptSessionConstrained(
        session,
        currentMessage,
        responseConstraint,
      );
    } catch (err) {
      emit("error", `Prompt failed: ${err.message}`);
      session.destroy();
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
      emit("response", lastResponse.slice(0, 200));
      debug(agentName, "Final answer received, ending loop");
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

      let resultMessage;
      try {
        const rawResult = await callTool(tc.name, tc.args);
        const result = slimToolResult(rawResult);
        const resultStr =
          typeof result === "string" ? result : JSON.stringify(result);
        const truncated =
          resultStr.length > 1200
            ? resultStr.slice(0, 1200) + "...[truncated]"
            : resultStr;
        debug(agentName, `=== TOOL RESULT: ${tc.name} ===\n` + truncated);
        emit("tool-result", {
          name: tc.name,
          result: truncated.slice(0, 200),
        });
        resultMessage = formatToolResult(tc.name, truncated);
      } catch (err) {
        debug(agentName, `=== TOOL ERROR: ${tc.name} ===\n` + err.message);
        emit("tool-error", { name: tc.name, error: err.message });
        resultMessage = formatToolResult(tc.name, { error: err.message });
      }

      currentMessage =
        "Tool results:\n" +
        resultMessage +
        "\n\nContinue based on these results.";
      lastResponse = response.text || "";
    }
  }

  session.destroy();
  emit("done", `${agentName} finished`);
  return lastResponse;
};
