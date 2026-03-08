import { createToolSession } from "./prompt-api.js";
import { makeTools } from "./tools.js";
import { runToolLoop } from "./tool-loop.js";
import { debug } from "../util/debug.js";
import { config } from "../config.js";
import { createEmitter } from "../util/activity.js";

/**
 * Slim down search results to reduce context size for the local model.
 * Keeps only the fields the agents need (title, href, date) and caps post count.
 */
const slimToolResult = (result) => {
  if (result && typeof result === "object" && Array.isArray(result.posts)) {
    return {
      postCount: Math.min(result.posts.length, config.agents.maxSearchPosts),
      posts: result.posts.slice(0, config.agents.maxSearchPosts).map((p) => ({
        title: p.title,
        href: p.href,
        date: p.date,
      })),
    };
  }
  return result;
};

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
  const emit = createEmitter(agentName, onActivity);

  emit("start", `${agentName} starting`);
  debug(agentName, "=== SYSTEM PROMPT ===\n" + systemPrompt);

  const executableTools = makeTools(tools, {
    transformResult: slimToolResult,
  });
  const session = await createToolSession(systemPrompt, executableTools);

  try {
    const result = await runToolLoop(session, userMessage, executableTools, {
      emit,
      agentName,
    });
    emit("done", `${agentName} finished`);
    return result;
  } finally {
    session.destroy();
  }
};
