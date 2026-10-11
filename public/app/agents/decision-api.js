/* global DecisionModel:false */
// Chrome Decisions API (`DecisionModel`): answers closed questions (boolean,
// choice, score) about an input and returns a probability per option.
// Explainer: https://github.com/explainers-by-googlers/decisions-api
// Behind chrome://flags/#decisions-api (desktop Chrome, Oct 2026).
//
// As implemented in Canary today, it wraps a general on-device model rather
// than a trained decision model: an LLM prompted with lettered options (the
// letter probabilities are the scores) or EmbeddingGemma similarity. Each
// question is a separate pass over the whole input, so cost grows with
// questions x input length.
//
// The schemas that use this live in triage.js.
import { debug } from "../util/debug.js";

/**
 * Feature-detect DecisionModel and check it can serve `schema`.
 * @returns {Promise<{ available: boolean, status?: string, reason?: string }>}
 */
export const checkDecisionAvailability = async (schema) => {
  if (typeof DecisionModel === "undefined") {
    return { available: false, reason: "Not available" };
  }
  try {
    const status = await DecisionModel.availability(schema);
    debug("decision-api", "DecisionModel.availability():", status);
    if (status === "unavailable") {
      return { available: false, status, reason: "Decision model unavailable" };
    }
    return { available: true, status };
  } catch (err) {
    return { available: false, reason: err.message };
  }
};

// One session per schema object, created once and shared.
const sessions = new Map();

/**
 * Create the session for `schema` once and share it. Call this soon after a
 * user gesture: create() refuses to start a model download without transient
 * user activation. A failed create is not cached, so the next call retries.
 */
export const getDecisionSession = (schema, emit) => {
  if (!sessions.has(schema)) {
    const promise = (async () => {
      const t0 = Date.now();
      const session = await DecisionModel.create({
        ...schema,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            debug(
              "decision-api",
              `Model download: ${Math.round(e.loaded * 100)}%`,
            );
          });
        },
      });
      const ms = Date.now() - t0;
      debug.timing("decision-api:create", ms);
      if (emit) emit("system", `DecisionModel session created in ${ms}ms`);
      return session;
    })().catch((err) => {
      sessions.delete(schema);
      throw err;
    });
    sessions.set(schema, promise);
  }
  return sessions.get(schema);
};

/** Run `decide()` on the session for `schema`. Returns the result and timing. */
export const decide = async (schema, input, emit) => {
  const session = await getDecisionSession(schema, emit);
  const t0 = Date.now();
  const result = await session.decide(input);
  const ms = Date.now() - t0;
  debug.timing("decision-api:decide", ms);
  debug("decision-api", "decide() result:", result);
  return { result, ms };
};
