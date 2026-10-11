/* global DecisionModel:false, URLSearchParams:false, window:false */
// Chrome Decisions API (`DecisionModel`): an on-device "System One" model that
// answers closed questions about an input in one pass and returns a
// probability per option, with no text generation.
// Explainer: https://github.com/explainers-by-googlers/decisions-api
// Behind chrome://flags/#decisions-api (desktop Chrome, Oct 2026).
import { debug } from "../util/debug.js";

const params = new URLSearchParams(window.location.search);

// `?decisions=off` forces Prompt API triage, to compare the two.
const DISABLED = params.get("decisions") === "off";

// How sure a signal must be before it can trigger research. Unneeded research
// costs far more than skipping it, so like the Prompt API triage ("default to
// false"), research needs a confident signal. Override: ?decisionConfidence=
const RESEARCH_CONFIDENCE = parseFloat(params.get("decisionConfidence")) || 0.8;

// One schema for the whole app, so one session serves every triage call.
// Three narrow yes/no questions rather than one blended choice: a single-pass
// model judges each simple signal better, and our code applies the rule from
// TRIAGE_BASE in prompts.js (see getTriageDecision).
export const TRIAGE_DECISION_SCHEMA = {
  context:
    "The input has an existing research notepad (post titles, sections and summary), the recent conversation, and the user's follow-up message.",
  expectedInputs: [{ type: "text", languages: ["en"] }],
  questions: [
    {
      id: "explicit_search",
      type: "boolean",
      prompt:
        "Does the user's follow-up explicitly ask to search for, find or look up new content?",
    },
    {
      id: "transform",
      type: "boolean",
      prompt:
        "Does the user's follow-up ask to rewrite, reformat, summarize, shorten, expand or change the tone or format of existing content?",
    },
    {
      id: "covered",
      type: "boolean",
      prompt:
        "Is the topic of the user's follow-up mentioned in the existing notepad?",
    },
  ],
};

// p(true) for a boolean answer.
const pTrue = (answer) =>
  answer.probabilities?.true ??
  (answer.label === "true" ? answer.confidence : 1 - answer.confidence);

/**
 * Apply the triage rule to a decide() result:
 * research = explicit search, or (topic not covered and not a transform).
 * @returns {{ needsResearch: boolean, reason: string, signals: Record<string, number> }}
 */
export const getTriageDecision = (result) => {
  const signals = {
    explicit_search: pTrue(result.explicit_search),
    transform: pTrue(result.transform),
    covered: pTrue(result.covered),
  };
  if (signals.explicit_search >= RESEARCH_CONFIDENCE) {
    return { needsResearch: true, reason: "explicit search", signals };
  }
  if (signals.transform >= 0.5) {
    return { needsResearch: false, reason: "transform", signals };
  }
  if (1 - signals.covered >= RESEARCH_CONFIDENCE) {
    return { needsResearch: true, reason: "topic not covered", signals };
  }
  return {
    needsResearch: false,
    reason: `no confident research signal (< ${RESEARCH_CONFIDENCE})`,
    signals,
  };
};

/**
 * Feature-detect DecisionModel and check it can serve the triage schema.
 * @returns {Promise<{ available: boolean, status?: string, reason?: string }>}
 */
export const checkDecisionAvailability = async () => {
  if (DISABLED)
    return { available: false, reason: "Disabled (?decisions=off)" };
  if (typeof DecisionModel === "undefined") {
    return { available: false, reason: "Not available" };
  }
  try {
    const status = await DecisionModel.availability(TRIAGE_DECISION_SCHEMA);
    debug("decision-api", "DecisionModel.availability():", status);
    if (status === "unavailable") {
      return { available: false, status, reason: "Decision model unavailable" };
    }
    return { available: true, status };
  } catch (err) {
    return { available: false, reason: err.message };
  }
};

let sessionPromise = null;

/**
 * Create the triage session once and share it. Call this soon after a user
 * gesture: create() refuses to start a model download without transient user
 * activation. A failed create is not cached, so the next run retries.
 */
export const getDecisionSession = (emit) => {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const t0 = Date.now();
      const session = await DecisionModel.create({
        ...TRIAGE_DECISION_SCHEMA,
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
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
};

/** Run `decide()` on the triage session. Returns the result and timing. */
export const decide = async (input, emit) => {
  const session = await getDecisionSession(emit);
  const t0 = Date.now();
  const result = await session.decide(input);
  const ms = Date.now() - t0;
  debug.timing("decision-api:decide", ms);
  debug("decision-api", "decide() result:", result);
  return { result, ms };
};
