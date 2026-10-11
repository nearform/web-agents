/* global DOMException:false, URLSearchParams:false, window:false */
// Tool calling with the Prompt API's native tool use. The model gets the tools
// as declarations and answers with tool calls; this loop runs them and sends
// the results back on the same session. See the notes on native tool use in
// prompt-api.js for what Chrome does and does not do.
import {
  checkToolSupport,
  checkContextBudget,
  createNativeToolSession,
  getContextInfo,
  promptNativeToolSession,
  toolError,
  toolSuccess,
} from "./prompt-api.js";
import { collectPostUrls, trimResult } from "./tool-loop.js";
import { formatToolResult } from "./tool-formatting.js";
import { debug } from "../util/debug.js";
import { config } from "../config.js";

const params = new URLSearchParams(window.location.search);

export const TOOL_CALLING_LABELS = {
  native: "native (Prompt API tool use)",
  manual: "manual (constrained JSON)",
};

/**
 * How agents call tools: `?toolcalls=manual` forces the manual loop,
 * otherwise native when Chrome supports it, else manual.
 * @returns {Promise<{ mode: "native"|"manual", check: object|null }>}
 */
export const pickToolCalling = async () => {
  if (params.get("toolcalls") === "manual")
    return { mode: "manual", check: null };
  const check = await checkToolSupport();
  return { mode: check.available ? "native" : "manual", check };
};

// Same sizing as the manual loop: at most half the free context per result.
const resultTokenBudget = (session, maxResultTokens) => {
  const { available } = checkContextBudget(session, "");
  if (available == null) return maxResultTokens;
  const reserve = config.context.resultTokenReserve || 100;
  return Math.max(
    200,
    Math.min(maxResultTokens, Math.floor(available * 0.5) - reserve),
  );
};

/**
 * Native tool loop: prompt → run the tool calls → send the results back →
 * repeat, until the model answers with text only or `maxIterations` prompts
 * have been sent. Returns the same shape as runToolLoop.
 */
export const runNativeToolLoop = async (
  systemPrompt,
  message,
  tools,
  options = {},
) => {
  const {
    maxIterations = config.agents.maxIterations,
    maxResultTokens = config.agents.maxResultTokens || 1000,
    emit = () => {},
    agentName = "agent",
    onContextUpdate,
    onAgentPrompt,
    signal,
  } = options;

  const collectedUrls = new Set();

  // Run one call and turn the outcome into a tool-response part. The text
  // that went back is returned too, for the activity log.
  const runCall = async (call, budget) => {
    const args = call.arguments ?? {};
    emit("tool-call", { name: call.name, args });
    debug(agentName, `=== CALLING TOOL: ${call.name} ===\nArgs:`, args);

    const tool = tools.find((t) => t.name === call.name);
    if (!tool) {
      const errMsg = `Unknown tool: ${call.name}`;
      emit("tool-error", { name: call.name, error: errMsg });
      return { part: toolError(call, errMsg), shown: { error: errMsg } };
    }
    try {
      const t0 = Date.now();
      const resultStr = await tool.execute(args);
      debug.timing(`tool:${call.name}`, Date.now() - t0);
      collectPostUrls(resultStr, collectedUrls);
      const trimmed = trimResult(resultStr, budget);
      debug(agentName, `=== TOOL RESULT: ${call.name} ===\n` + trimmed);
      emit("tool-result", { name: call.name, result: resultStr });
      return { part: toolSuccess(call, trimmed), shown: trimmed };
    } catch (err) {
      if (err.name === "AbortError") throw err;
      debug(agentName, `=== TOOL ERROR: ${call.name} ===\n` + err.message);
      emit("tool-error", { name: call.name, error: err.message });
      return {
        part: toolError(call, err.message),
        shown: { error: err.message },
      };
    }
  };

  const session = await createNativeToolSession(systemPrompt, tools);
  let text = "";
  try {
    let input = message;
    let shownInput = message;
    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const iterStart = Date.now();

      if (onAgentPrompt) onAgentPrompt(agentName, "user", shownInput);
      emit("prompt", {
        summary: `Sending message (iteration ${i + 1}, native tools)`,
        prompt: shownInput,
      });
      debug(agentName, `=== INPUT (iteration ${i + 1}) ===\n` + shownInput);

      let response;
      try {
        response = await promptNativeToolSession(session, input, { signal });
      } catch (err) {
        if (err.name !== "AbortError") {
          emit("error", `Prompt failed: ${err.message}`);
        }
        throw err;
      }
      if (onContextUpdate) {
        const info = getContextInfo(session);
        if (info) onContextUpdate(info);
      }
      if (response.text) {
        text = response.text;
        if (onAgentPrompt) onAgentPrompt(agentName, "answer", text);
      }
      debug(
        agentName,
        `=== OUTPUT (iteration ${i + 1}) ===\n` +
          JSON.stringify(
            {
              text: response.text,
              calls: response.calls.map((c) => ({
                name: c.name,
                arguments: c.arguments,
              })),
            },
            null,
            2,
          ),
      );

      if (response.calls.length === 0) {
        emit("response", text);
        debug.timing(`${agentName}:iter${i + 1}`, Date.now() - iterStart);
        break;
      }
      if (i === maxIterations - 1) {
        emit(
          "error",
          `Stopped after ${maxIterations} prompts with tool calls still pending`,
        );
        break;
      }

      const budget = resultTokenBudget(session, maxResultTokens);
      const results = [];
      for (const call of response.calls) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        results.push({ call, ...(await runCall(call, budget)) });
      }
      input = [{ role: "user", content: results.map((r) => r.part) }];
      shownInput =
        "Tool results:\n" +
        results.map((r) => formatToolResult(r.call.name, r.shown)).join("\n");
      debug.timing(`${agentName}:iter${i + 1}`, Date.now() - iterStart);
    }
  } finally {
    session.destroy();
  }

  return { text, validUrls: [...collectedUrls] };
};
