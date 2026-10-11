/* global LanguageModel:false, LanguageModelToolSuccess:false, LanguageModelToolError:false, setTimeout:false, DOMException:false */
import { debug } from "../util/debug.js";
import { config } from "../config.js";

const PROMPT_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export const checkAvailability = async () => {
  if (typeof LanguageModel === "undefined") {
    return { available: false, reason: "Not available" };
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

/* ── Context tracking ────────────────────────────────────────── */

export const getContextInfo = (session) => {
  try {
    // New API: session.contextUsage / session.contextWindow (direct numbers)
    // Old API fallback: session.inputUsage / session.inputQuota
    const used = session.contextUsage ?? session.inputUsage ?? null;
    const total = session.contextWindow ?? session.inputQuota ?? null;
    if (used == null || total == null) return null;
    return { used, total, pct: Math.round((used / total) * 100) };
  } catch {
    return null;
  }
};

export const estimateTokens = (text) =>
  Math.ceil(text.length / config.context.charsPerToken);

export const tokensToChars = (tokens) => tokens * config.context.charsPerToken;

export const checkContextBudget = (session, text) => {
  const info = getContextInfo(session);
  const estimated = estimateTokens(text);
  if (!info) return { fits: true, estimated, available: null, pct: null };

  const available = info.total - info.used;
  const pct = info.pct;

  if (pct >= config.context.criticalPct) {
    debug.warn(
      "prompt-api",
      `Context CRITICAL: ${pct}% used (${info.used}/${info.total}), ` +
        `estimated next prompt: ${estimated} tokens`,
    );
  } else if (pct >= config.context.warnPct) {
    debug.warn(
      "prompt-api",
      `Context WARNING: ${pct}% used (${info.used}/${info.total})`,
    );
  }

  return { fits: estimated <= available, estimated, available, pct };
};

const logContextAfterPrompt = (session, label) => {
  const info = getContextInfo(session);
  if (!info) return;
  debug(
    "prompt-api",
    `Context after ${label}: ${info.pct}% (${info.used}/${info.total})`,
  );
  if (info.pct >= config.context.criticalPct) {
    debug.warn(
      "prompt-api",
      `Context CRITICAL after ${label}: ${info.pct}% (${info.used}/${info.total})`,
    );
  } else if (info.pct >= config.context.warnPct) {
    debug.warn(
      "prompt-api",
      `Context WARNING after ${label}: ${info.pct}% (${info.used}/${info.total})`,
    );
  }
};

/* ── Session creation ────────────────────────────────────────── */

export const createSession = async (systemPrompt) => {
  debug(
    "prompt-api",
    "Creating session, system prompt length:",
    systemPrompt.length,
  );
  const t0 = Date.now();
  const session = await LanguageModel.create({
    ...PROMPT_OPTIONS,
    initialPrompts: [{ role: "system", content: systemPrompt }],
  });
  debug.timing("createSession", Date.now() - t0);
  debug("prompt-api", "Session created, inputQuota:", session.inputQuota);
  return session;
};

/**
 * Create a session for the manual tool loop (see runToolLoop). The model does
 * not see the tools as declarations here: the loop describes them in the system
 * prompt and reads tool calls out of constrained JSON.
 *
 * `history` is replayed into `initialPrompts` after the system prompt. Callers
 * use this to rebuild a conversation on a fresh session — see the one-constraint
 * -per-session limitation documented on promptSessionConstrained().
 */
export const createToolSession = async (systemPrompt, history = []) => {
  debug(
    "prompt-api",
    "Creating tool session, system prompt length:",
    systemPrompt.length,
  );
  const t0 = Date.now();
  const session = await LanguageModel.create({
    ...PROMPT_OPTIONS,
    initialPrompts: [{ role: "system", content: systemPrompt }, ...history],
  });
  debug.timing("createToolSession", Date.now() - t0);
  debug("prompt-api", "Tool session created, inputQuota:", session.inputQuota);
  return session;
};

/* ── Native tool use ─────────────────────────────────────────── */

// Native tool use (Prompt API tool use, chrome://flags/#prompt-api-tool-use).
// Explainer: https://github.com/webmachinelearning/prompt-api#tool-use
//
// As implemented in Chrome Canary 157 (Oct 2026):
// - The page runs the tools, not Chrome. create() reads only `name`,
//   `description` and `inputSchema` from each tool and ignores `execute`.
//   prompt() resolves to an array of parts, such as
//   [{ type: "tool-call", value: LanguageModelToolCall }], where the call has
//   `callId` (empty so far), `name` and `arguments` (an object).
// - Results go back as a user message of `tool-response` parts, each a
//   LanguageModelToolSuccess or LanguageModelToolError. Plain objects are
//   rejected. The whole exchange stays on one session.
// - `tools` requires `{ type: "tool-call" }` in expectedOutputs (TypeError
//   otherwise).
// - availability() says "available" for tool-call outputs even with the flag
//   off, so it cannot detect the feature. create() is the test: with the flag
//   off it throws NotSupportedError.
// - responseConstraint does not combine usefully with tools: the model still
//   returns a tool call, and a second constrained prompt fails with
//   kErrorUnknown, as it does without tools.
// - Chrome adds each declaration to the system turn as a short
//   `<tool name=... schema=...>` tag (see Event Logs in
//   chrome://on-device-internals).
const NATIVE_TOOL_OPTIONS = {
  expectedInputs: [...PROMPT_OPTIONS.expectedInputs, { type: "tool-response" }],
  expectedOutputs: [...PROMPT_OPTIONS.expectedOutputs, { type: "tool-call" }],
};

const PROBE_TOOL = {
  name: "probe",
  description: "Feature detection only.",
  inputSchema: { type: "object", properties: {} },
};

let toolSupport = null;

/**
 * Feature-detect native tool use by creating (and destroying) a session with
 * one tool. Cached: the answer only changes when Chrome is relaunched.
 * @returns {Promise<{ available: boolean, reason?: string }>}
 */
export const checkToolSupport = () => {
  toolSupport ??= (async () => {
    if (
      typeof LanguageModel === "undefined" ||
      typeof LanguageModelToolSuccess === "undefined"
    ) {
      return { available: false, reason: "Not available" };
    }
    try {
      const t0 = Date.now();
      const probe = await LanguageModel.create({
        ...NATIVE_TOOL_OPTIONS,
        tools: [PROBE_TOOL],
      });
      probe.destroy();
      debug.timing("checkToolSupport", Date.now() - t0);
      return { available: true };
    } catch (err) {
      debug("prompt-api", "Native tool use probe failed:", err);
      return { available: false, reason: `${err.name}: ${err.message}` };
    }
  })();
  return toolSupport;
};

/** Create a session that declares `tools` to the model natively. */
export const createNativeToolSession = async (systemPrompt, tools) => {
  debug(
    "prompt-api",
    "Creating native tool session, system prompt length:",
    systemPrompt.length,
    "tools:",
    tools.length,
  );
  const t0 = Date.now();
  const session = await LanguageModel.create({
    ...NATIVE_TOOL_OPTIONS,
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
    initialPrompts: [{ role: "system", content: systemPrompt }],
  });
  debug.timing("createNativeToolSession", Date.now() - t0);
  return session;
};

/** A tool-response part for a call that succeeded. */
export const toolSuccess = (call, text) => ({
  type: "tool-response",
  value: new LanguageModelToolSuccess({
    callId: call.callId,
    name: call.name,
    result: [{ type: "text", value: text }],
  }),
});

/** A tool-response part for a call that failed. */
export const toolError = (call, message) => ({
  type: "tool-response",
  value: new LanguageModelToolError({
    callId: call.callId,
    name: call.name,
    errorMessage: message,
  }),
});

/* ── Prompting helpers ───────────────────────────────────────── */

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

export const promptSession = async (session, message) => {
  debug("prompt-api", "Prompting, message length:", message.length);
  const t0 = Date.now();
  const result = await session.prompt(message);
  debug.timing("prompt", Date.now() - t0);
  logContextAfterPrompt(session, "prompt");
  debug("prompt-api", "Response length:", result.length);
  return result;
};

export const promptSessionStreaming = async (
  session,
  message,
  onChunk,
  { signal } = {},
) => {
  debug("prompt-api", "Streaming prompt, message length:", message.length);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const t0 = Date.now();
  const stream = session.promptStreaming(message);
  let result = "";
  const streamPromise = (async () => {
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      result += chunk;
      if (onChunk) onChunk(result);
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  })();
  const final = await withTimeout(streamPromise, config.timeouts.promptMs);
  debug.timing("streaming", Date.now() - t0);
  logContextAfterPrompt(session, "streaming");
  debug("prompt-api", "Streaming complete, length:", final.length);
  return final;
};

/**
 * Prompt with constrained decoding.
 *
 * IMPORTANT — one constrained prompt per session. As of Chrome 151, a second
 * `responseConstraint` prompt on a session that has already served one always
 * rejects with `UnknownError: An unknown error occurred: kErrorUnknown`, well
 * below any context limit. `clone()` inherits the state and fails too, and
 * `append()` does not avoid it. Unconstrained prompts on the same session are
 * unaffected, and a fresh session replaying the conversation via
 * `initialPrompts` works — that is how runToolLoop drives multi-turn agents.
 */
export const promptSessionConstrained = async (
  session,
  message,
  responseConstraint,
) => {
  debug("prompt-api", "Constrained prompt, message length:", message.length);
  const t0 = Date.now();
  const result = await withTimeout(
    session.prompt(message, { responseConstraint }),
    config.timeouts.promptMs,
  );
  debug.timing("constrained", Date.now() - t0);
  logContextAfterPrompt(session, "constrained");
  debug("prompt-api", "Constrained response length:", result.length);
  return result;
};

/**
 * Prompt a native tool session. `input` is a string or a list of messages (for
 * tool responses). Resolves to the response split into `text` and `calls`
 * (LanguageModelToolCall objects).
 */
export const promptNativeToolSession = async (
  session,
  input,
  { signal } = {},
) => {
  const t0 = Date.now();
  const parts = await withTimeout(
    session.prompt(input, { signal }),
    config.timeouts.promptMs,
  );
  debug.timing("nativeToolPrompt", Date.now() - t0);
  logContextAfterPrompt(session, "native tool prompt");
  const list =
    typeof parts === "string" ? [{ type: "text", value: parts }] : parts;
  return {
    text: list
      .filter((p) => p.type === "text")
      .map((p) => p.value)
      .join(""),
    calls: list.filter((p) => p.type === "tool-call").map((p) => p.value),
  };
};

/**
 * Constrained prompt with automatic retry on timeout.
 * On timeout, calls `shortenContext(message)` to get a shorter version and retries once.
 *
 * The retry runs on a session from `createRetrySession()` rather than reusing
 * `session`: Chrome allows only one responseConstraint prompt per session (see
 * promptSessionConstrained), so retrying in place would fail with kErrorUnknown
 * instead of surfacing the real timeout.
 */
export const promptSessionConstrainedWithRetry = async (
  session,
  message,
  responseConstraint,
  { shortenContext, onRetry, createRetrySession } = {},
) => {
  try {
    const t0 = Date.now();
    const r = await promptSessionConstrained(
      session,
      message,
      responseConstraint,
    );
    debug.timing("constrainedWithRetry:ok", Date.now() - t0);
    return r;
  } catch (err) {
    if (
      !err.message.includes("timed out") ||
      !shortenContext ||
      !createRetrySession
    ) {
      throw err;
    }
    debug.warn("prompt-api", "Prompt timed out, retrying with shorter context");
    const shorter = shortenContext(message);
    if (onRetry) onRetry(shorter);
    const t0 = Date.now();
    const retrySession = await createRetrySession();
    try {
      const r = await promptSessionConstrained(
        retrySession,
        shorter,
        responseConstraint,
      );
      debug.timing("constrainedWithRetry:retry", Date.now() - t0);
      return r;
    } finally {
      retrySession.destroy();
    }
  }
};
