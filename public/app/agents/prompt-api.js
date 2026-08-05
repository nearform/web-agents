/* global LanguageModel:false, setTimeout:false, DOMException:false */
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
 * Create a session that is aware of tools.
 * When Chrome ships native tool support, tools are passed to LanguageModel.create()
 * and session.prompt() handles the tool loop internally.
 * Until then, behaves identically to createSession (tools are handled manually).
 *
 * `history` is replayed into `initialPrompts` after the system prompt. Callers
 * use this to rebuild a conversation on a fresh session — see the one-constraint
 * -per-session limitation documented on promptSessionConstrained().
 */
export const createToolSession = async (
  systemPrompt,
  tools = [],
  history = [],
) => {
  const opts = {
    ...PROMPT_OPTIONS,
    initialPrompts: [{ role: "system", content: systemPrompt }, ...history],
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
  const t0 = Date.now();
  const session = await LanguageModel.create(opts);
  debug.timing("createToolSession", Date.now() - t0);
  debug("prompt-api", "Tool session created, inputQuota:", session.inputQuota);
  return session;
};

// Placeholder — will refine when the Prompt API tool-use spec ships.
const hasNativeToolSupport = () => false;

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
