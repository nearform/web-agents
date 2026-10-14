/* global URLSearchParams:false, window:false */
// Triage: does a follow-up need new research, or can the existing notepad
// answer it? Every strategy gets the same input text, so the app
// (coordinator.js) and the test page (public/tests/triage.html) compare like
// with like.
import {
  createSession,
  promptSessionConstrained,
  getContextInfo,
} from "./prompt-api.js";
import { getTriageSystemPrompt } from "./prompts.js";
import { formatChatHistory } from "../util/chat-history.js";
import { checkDecisionAvailability, decide } from "./decision-api.js";

const params = new URLSearchParams(window.location.search);

/* ── Input ───────────────────────────────────────────────────── */

const NOTEPAD_BUDGET = 4000;
const HISTORY_BUDGET = 2000;

// Links are noise for triage: keep a link's text, drop its URL and bare URLs.
const stripLinks = (text) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\(?https?:\/\/[^\s)]+\)?/g, "")
    .replace(/[ \t]{2,}/g, " ");

// The Citations section repeats post titles already listed under Posts.
const dropCitations = (notepad) =>
  notepad.replace(/^## Citations[\s\S]*?(?=^## |(?![\s\S]))/m, "");

const cutAtLine = (text, budget) => {
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf("\n", budget);
  return text.slice(0, cut > 0 ? cut : budget) + "\n...";
};

/**
 * The text every strategy judges: the full research notepad, the conversation
 * so far (both sides), and the user's new message.
 */
export const buildTriageInput = ({ userMessage, notepad, chatHistory }) => {
  const research = cutAtLine(
    stripLinks(dropCitations(notepad ?? "")).trim(),
    NOTEPAD_BUDGET,
  );
  const history = stripLinks(
    formatChatHistory(chatHistory, { maxChars: HISTORY_BUDGET }),
  ).trim();
  return [
    `Research notepad:\n${research}`,
    history && `Conversation so far:\n${history}`,
    `User's new message: "${userMessage}"`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

/* ── Strategy: Prompt API ────────────────────────────────────── */

const PROMPT_API_SCHEMA = {
  type: "object",
  properties: { needs_research: { type: "boolean" } },
  required: ["needs_research"],
};

const runPromptApi = async (input, { userMessage }) => {
  const session = await createSession(getTriageSystemPrompt(userMessage));
  try {
    const t0 = Date.now();
    const raw = await promptSessionConstrained(
      session,
      input,
      PROMPT_API_SCHEMA,
    );
    const ms = Date.now() - t0;
    const parsed = JSON.parse(raw);
    return {
      needsResearch: parsed.needs_research === true,
      pResearch: null,
      reason: `model answered ${raw}`,
      ms,
      raw: parsed,
      contextInfo: getContextInfo(session),
    };
  } finally {
    session.destroy();
  }
};

/* ── Strategy: DecisionModel, one choice question ────────────── */

// The rules from TRIAGE_BASE (prompts.js) live in the option descriptions:
// that and the question are all the model sees besides the input.
export const CHOICE_SCHEMA = {
  context:
    "A research assistant answers questions from a research notepad it built earlier. The input holds the notepad, the conversation so far, and the user's new message.",
  expectedInputs: [{ type: "text", languages: ["en"] }],
  questions: [
    {
      id: "next_step",
      type: "choice",
      prompt: "What should the assistant do with the user's new message?",
      options: [
        {
          label: "reuse",
          description:
            "Answer from the notepad: the message is about something the notepad covers, even partly, or asks to rewrite, reformat, summarize, shorten, expand or change the tone or format of earlier answers.",
        },
        {
          label: "research",
          description:
            "Search for new content: the message is about a company, person, project, technology or topic the notepad does not mention, or explicitly asks to search, find or look up something.",
        },
      ],
    },
  ],
};

// p(research) at or above this means research. Override: ?researchThreshold=
//
// Not 0.5: the scores lean toward whichever option is listed last. With
// "research" second, a message the notepad plainly answers ("what does MCP
// stand for again?") still scores 0.6-0.7, and with the options swapped the
// same messages score under 0.3. The ranking holds up, so the cut moves
// instead: on the 21 cases in public/tests/triage-cases.js (Canary 157, Oct
// 2026), 0.5 gets 15 right, all six misses unneeded research; 0.7 gets 20.
// Reuse is the default, so research needs a high score.
const RESEARCH_THRESHOLD = parseFloat(params.get("researchThreshold")) || 0.7;

const runDecisionChoice = async (
  input,
  { emit, threshold = RESEARCH_THRESHOLD } = {},
) => {
  const { result, ms } = await decide(CHOICE_SCHEMA, input, emit);
  const pResearch = result.next_step.probabilities.research ?? 0;
  const needsResearch = pResearch >= threshold;
  return {
    needsResearch,
    pResearch,
    reason: `p(research) ${pResearch.toFixed(2)} ${needsResearch ? ">=" : "<"} ${threshold}`,
    ms,
    raw: result,
  };
};

/* ── Strategy: DecisionModel, three yes/no questions ─────────── */

export const BOOLEANS_SCHEMA = {
  context:
    "The input holds a research notepad, the conversation so far, and the user's new message.",
  expectedInputs: [{ type: "text", languages: ["en"] }],
  questions: [
    {
      id: "explicit_search",
      type: "boolean",
      prompt:
        "Does the user's new message explicitly ask to search for, find or look up new content?",
    },
    {
      id: "transform",
      type: "boolean",
      prompt:
        "Does the user's new message ask to rewrite, reformat, summarize, shorten, expand or change the tone or format of existing content?",
    },
    {
      id: "covered",
      type: "boolean",
      prompt:
        "Is the topic of the user's new message mentioned in the research notepad?",
    },
  ],
};

// How sure a signal must be before it can trigger research.
const SIGNAL_CONFIDENCE = 0.8;

const pTrue = (answer) =>
  answer.probabilities?.true ??
  (answer.label === "true" ? answer.confidence : 1 - answer.confidence);

const runDecisionBooleans = async (input, { emit } = {}) => {
  const { result, ms } = await decide(BOOLEANS_SCHEMA, input, emit);
  const s = {
    explicit_search: pTrue(result.explicit_search),
    transform: pTrue(result.transform),
    covered: pTrue(result.covered),
  };
  // research = explicit search, or (topic not covered and not a transform)
  const [needsResearch, why] =
    s.explicit_search >= SIGNAL_CONFIDENCE
      ? [true, "explicit search"]
      : s.transform >= 0.5
        ? [false, "transform"]
        : 1 - s.covered >= SIGNAL_CONFIDENCE
          ? [true, "topic not covered"]
          : [false, "no confident research signal"];
  const probs = Object.entries(s)
    .map(([id, p]) => `${id} ${p.toFixed(2)}`)
    .join(", ");
  return {
    needsResearch,
    pResearch: null,
    reason: `${why} — p(true): ${probs}`,
    ms,
    raw: result,
  };
};

/* ── Registry ────────────────────────────────────────────────── */

export const STRATEGIES = {
  "prompt-api": {
    label: "Prompt API",
    schema: null,
    run: runPromptApi,
    describe: (input, userMessage) =>
      `System prompt:\n${getTriageSystemPrompt(userMessage)}\n\nInput:\n${input}`,
  },
  "decision-choice": {
    label: "DecisionModel (choice)",
    schema: CHOICE_SCHEMA,
    run: runDecisionChoice,
    describe: (input) =>
      `Schema:\n${JSON.stringify(CHOICE_SCHEMA, null, 2)}\n\nInput:\n${input}`,
  },
  "decision-booleans": {
    label: "DecisionModel (3 booleans)",
    schema: BOOLEANS_SCHEMA,
    run: runDecisionBooleans,
    describe: (input) =>
      `Schema:\n${JSON.stringify(BOOLEANS_SCHEMA, null, 2)}\n\nInput:\n${input}`,
  },
};

/**
 * The strategy the app uses: `?triage=<key>` if given, otherwise
 * decision-choice when DecisionModel can serve it, otherwise prompt-api.
 * A DecisionModel strategy that is unavailable falls back to prompt-api.
 * @returns {Promise<{ key: string, check: object|null }>}
 */
export const pickTriageStrategy = async () => {
  const requested = params.get("triage");
  const key = STRATEGIES[requested] ? requested : "decision-choice";
  const { schema } = STRATEGIES[key];
  if (!schema) return { key, check: null };
  const check = await checkDecisionAvailability(schema);
  return { key: check.available ? key : "prompt-api", check };
};
