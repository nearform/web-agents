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
