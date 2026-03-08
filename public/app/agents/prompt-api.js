/* global LanguageModel:false, setTimeout:false */
import { debug } from "../util/debug.js";
import { config } from "../config.js";

const PROMPT_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export const checkAvailability = async () => {
  if (typeof LanguageModel === "undefined") {
    return { available: false, reason: "Prompt API not available" };
  }
  try {
    const status = await LanguageModel.availability(PROMPT_OPTIONS);
    debug("prompt-api", "LanguageModel.availability():", status);
    if (status === "unavailable") {
      return { available: false, reason: "Language model unavailable" };
    }
    return { available: true, status };
  } catch (err) {
    return { available: false, reason: err.message };
  }
};

export const createSession = async (systemPrompt) => {
  debug(
    "prompt-api",
    "Creating session, system prompt length:",
    systemPrompt.length,
  );
  const session = await LanguageModel.create({
    ...PROMPT_OPTIONS,
    initialPrompts: [{ role: "system", content: systemPrompt }],
  });
  debug("prompt-api", "Session created, inputQuota:", session.inputQuota);
  return session;
};

/**
 * Create a session that is aware of tools.
 * When Chrome ships native tool support, tools are passed to LanguageModel.create()
 * and session.prompt() handles the tool loop internally.
 * Until then, behaves identically to createSession (tools are handled manually).
 */
export const createToolSession = async (systemPrompt, tools = []) => {
  const opts = {
    ...PROMPT_OPTIONS,
    initialPrompts: [{ role: "system", content: systemPrompt }],
  };
  // When Chrome ships native tool support, this branch activates
  if (hasNativeToolSupport() && tools.length > 0) {
    opts.tools = tools;
  }
  debug(
    "prompt-api",
    "Creating tool session, system prompt length:",
    systemPrompt.length,
    "tools:",
    tools.length,
  );
  const session = await LanguageModel.create(opts);
  debug("prompt-api", "Tool session created, inputQuota:", session.inputQuota);
  return session;
};

// Placeholder — will refine when the Prompt API tool-use spec ships.
// Chrome exposes LanguageModel.prompt() today but does NOT yet accept a
// `tools` option.  We detect native support by attempting to create a
// session with a dummy tool — if Chrome throws, the feature isn't ready.
// For now, hard-return false until the spec lands.
const hasNativeToolSupport = () => false;

export const promptSession = async (session, message) => {
  debug("prompt-api", "Prompting, message length:", message.length);
  const result = await session.prompt(message);
  debug("prompt-api", "Response length:", result.length);
  return result;
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Prompt timed out after ${ms / 1000}s`)),
        ms,
      ),
    ),
  ]);

export const promptSessionStreaming = async (session, message, onChunk) => {
  debug("prompt-api", "Streaming prompt, message length:", message.length);
  const stream = session.promptStreaming(message);
  let result = "";
  for await (const chunk of stream) {
    result += chunk;
    if (onChunk) onChunk(result);
  }
  debug("prompt-api", "Streaming complete, length:", result.length);
  return result;
};

export const promptSessionConstrained = async (
  session,
  message,
  responseConstraint,
) => {
  debug("prompt-api", "Constrained prompt, message length:", message.length);
  const result = await withTimeout(
    session.prompt(message, { responseConstraint }),
    config.timeouts.promptMs,
  );
  debug("prompt-api", "Constrained response length:", result.length);
  return result;
};
