import { createSession, promptSession } from "./prompt-api.js";
import {
  parseToolCalls,
  hasToolCalls,
  formatToolResult,
} from "./tool-call-parser.js";
import { callTool } from "../bridge/tool-registry.js";
import { debug } from "../util/debug.js";

const MAX_ITERATIONS = 3;

/**
 * Run an agent loop: prompt the model, parse tool calls, execute them,
 * feed results back, repeat until no more tool calls or max iterations.
 */
export const runAgentLoop = async ({
  systemPrompt,
  userMessage,
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
  let currentMessage = userMessage;
  let lastResponse = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    emit("prompt", `Sending message (iteration ${i + 1})`);
    debug(agentName, `=== INPUT (iteration ${i + 1}) ===\n` + currentMessage);

    try {
      lastResponse = await promptSession(session, currentMessage);
    } catch (err) {
      emit("error", `Prompt failed: ${err.message}`);
      session.destroy();
      throw err;
    }

    debug(
      agentName,
      `=== FULL OUTPUT (iteration ${i + 1}) ===\n` + lastResponse,
    );
    emit("response", lastResponse.slice(0, 200));

    const hasTC = hasToolCalls(lastResponse);
    debug(agentName, "hasToolCalls:", hasTC);

    if (!hasTC) {
      debug(agentName, "No <tool_call> tags found, ending loop");
      break;
    }

    const toolCalls = parseToolCalls(lastResponse);
    debug(agentName, "Parsed tool calls:", JSON.stringify(toolCalls, null, 2));
    if (toolCalls.length === 0) {
      debug(agentName, "hasToolCalls=true but parsed 0, ending loop");
      break;
    }

    const results = [];
    for (const tc of toolCalls) {
      emit("tool-call", { name: tc.name, args: tc.args });
      debug(
        agentName,
        `=== CALLING TOOL: ${tc.name} ===\nArgs:`,
        JSON.stringify(tc.args, null, 2),
      );
      try {
        const result = await callTool(tc.name, tc.args);
        const resultStr =
          typeof result === "string" ? result : JSON.stringify(result);
        const truncated =
          resultStr.length > 2000
            ? resultStr.slice(0, 2000) + "...[truncated]"
            : resultStr;
        debug(agentName, `=== TOOL RESULT: ${tc.name} ===\n` + truncated);
        emit("tool-result", {
          name: tc.name,
          result: truncated.slice(0, 200),
        });
        results.push(formatToolResult(tc.name, truncated));
      } catch (err) {
        debug(agentName, `=== TOOL ERROR: ${tc.name} ===\n` + err.message);
        emit("tool-error", { name: tc.name, error: err.message });
        results.push(formatToolResult(tc.name, { error: err.message }));
      }
    }

    currentMessage =
      "Tool results:\n" +
      results.join("\n") +
      "\n\nContinue based on these results.";
  }

  session.destroy();
  emit("done", `${agentName} finished`);
  return lastResponse;
};
