import { createToolSession } from "./prompt-api.js";
import { makeTools } from "./tools.js";
import { runToolLoop } from "./tool-loop.js";
import {
  pickToolCalling,
  runNativeToolLoop,
  TOOL_CALLING_LABELS,
} from "./native-tool-loop.js";
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
 * Run an agent loop: prompt the model, execute the tool calls it asks for,
 * feed results back, repeat until it answers or max iterations.
 *
 * Tools are called natively when Chrome supports Prompt API tool use (see
 * pickToolCalling), otherwise through the manual constrained-JSON loop. A
 * native run that fails is retried with the manual loop.
 *
 * `getSystemPrompt({ native })` returns the system prompt for each mode: the
 * manual loop has to describe the tools and the JSON reply format itself.
 */
export const runAgentLoop = async ({
  getSystemPrompt,
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

  const { mode, check } = await pickToolCalling();
  emit(
    "system",
    `Tool calling: ${TOOL_CALLING_LABELS[mode]}${
      check && !check.available ? ` (native tool use: ${check.reason})` : ""
    }`,
  );

  const sendSystemPrompt = (native) => {
    const systemPrompt = getSystemPrompt({ native });
    debug(agentName, "=== SYSTEM PROMPT ===\n" + systemPrompt);
    if (onAgentPrompt) onAgentPrompt(agentName, "system", systemPrompt);
    emit("prompt", {
      summary: `${agentName} system prompt`,
      prompt: systemPrompt,
      kind: "system",
    });
    return systemPrompt;
  };

  const executableTools = makeTools(tools, {
    transformResult: slimToolResult,
  });
  const loopOptions = {
    emit,
    agentName,
    onContextUpdate,
    onAgentPrompt,
    signal,
  };

  const runManual = () => {
    const systemPrompt = sendSystemPrompt(false);
    // One constrained prompt per session is all Chrome allows, so the loop
    // owns session lifecycle: a fresh session per iteration, replaying
    // `history`.
    const createIterationSession = (history) =>
      createToolSession(systemPrompt, history);
    return runToolLoop(
      createIterationSession,
      userMessage,
      executableTools,
      loopOptions,
    );
  };

  let result;
  if (mode === "native") {
    try {
      result = await runNativeToolLoop(
        sendSystemPrompt(true),
        userMessage,
        executableTools,
        loopOptions,
      );
    } catch (err) {
      if (err.name === "AbortError") throw err;
      debug.warn(
        agentName,
        `Native tool loop failed: ${err.name}: ${err.message}`,
      );
      emit(
        "error",
        `Native tool calling failed, using the manual tool loop: ${err.message}`,
      );
      result = await runManual();
    }
  } else {
    result = await runManual();
  }
  const { text, validUrls } = result;
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
