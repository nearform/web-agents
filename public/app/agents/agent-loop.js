import { createToolSession } from "./prompt-api.js";
import { makeTools } from "./tools.js";
import { runToolLoop } from "./tool-loop.js";
import { debug } from "../util/debug.js";
import { config } from "../config.js";
import { createEmitter } from "../util/activity.js";

/**
 * Slim down search results to reduce context size for the local model.
 * Keeps top posts with article excerpts from matching chunks.
 */
const slimToolResult = (result) => {
  if (!result || typeof result !== "object" || !Array.isArray(result.posts)) {
    return result;
  }
  const maxPosts = config.agents.maxSearchPosts;
  const posts = result.posts.slice(0, maxPosts);
  const chunkMap = new Map();
  if (Array.isArray(result.chunks)) {
    for (const c of result.chunks) {
      chunkMap.set(c.slug, c.text);
    }
  }
  return {
    postCount: Math.min(result.posts.length, maxPosts),
    posts: posts.map((p) => {
      // chunk.text arrives as an array of strings; slicing it directly would
      // cap the number of chunks rather than the character count, leaving
      // excerpts effectively untruncated.
      const chunk = chunkMap.get(p.slug);
      const text = Array.isArray(chunk) ? chunk.join("\n\n") : (chunk ?? "");
      return {
        title: p.title,
        href: p.href,
        date: p.date,
        excerpt: text.slice(0, config.agents.maxExcerptChars || 800),
      };
    }),
  };
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
  onContextUpdate,
  onAgentPrompt,
  signal,
}) => {
  const emit = createEmitter(agentName, onActivity);

  emit("start", `${agentName} starting`);
  debug(agentName, "=== SYSTEM PROMPT ===\n" + systemPrompt);
  if (onAgentPrompt) onAgentPrompt(agentName, "system", systemPrompt);
  emit("prompt", {
    summary: `${agentName} system prompt`,
    prompt: systemPrompt,
    kind: "system",
  });

  const executableTools = makeTools(tools, {
    transformResult: slimToolResult,
  });

  // One constrained prompt per session is all Chrome allows, so the loop owns
  // session lifecycle: a fresh session per iteration, replaying `history`.
  const createIterationSession = (history) =>
    createToolSession(systemPrompt, executableTools, history);

  const { text, validUrls } = await runToolLoop(
    createIterationSession,
    userMessage,
    executableTools,
    {
      emit,
      agentName,
      onContextUpdate,
      onAgentPrompt,
      signal,
    },
  );
  emit("done", `${agentName} finished`);

  if (validUrls && validUrls.length > 0) {
    return (
      text +
      "\n\n## Verified URLs\nOnly use URLs from this list:\n" +
      validUrls.map((u) => `- ${u}`).join("\n")
    );
  }
  return text;
};
