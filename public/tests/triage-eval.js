/* global document:false, window:false, navigator:false */
// Runs the labelled triage cases through each strategy in app/agents/triage.js
// and reports accuracy and latency. Also scriptable over CDP:
//   await window.runTriageEval({ strategies: ["prompt-api"], caseIds: [...] })
import { CASES } from "./triage-cases.js";
import { STRATEGIES, buildTriageInput } from "../app/agents/triage.js";
import { checkDecisionAvailability } from "../app/agents/decision-api.js";

const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

const $ = (sel) => document.querySelector(sel);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const verdict = (research) => (research ? "research" : "reuse");

const caseInput = (c) =>
  buildTriageInput({
    userMessage: c.message,
    notepad: c.notepad,
    // formatChatHistory drops the last entry (the message being triaged).
    chatHistory: [...c.history, { role: "user", text: c.message }],
  });

const runOne = async (key, c) => {
  try {
    const r = await STRATEGIES[key].run(caseInput(c), {
      userMessage: c.message,
    });
    return {
      id: c.id,
      strategy: key,
      expected: c.research,
      needsResearch: r.needsResearch,
      correct: r.needsResearch === c.research,
      pResearch: r.pResearch,
      reason: r.reason,
      ms: r.ms,
      raw: r.raw,
    };
  } catch (err) {
    return {
      id: c.id,
      strategy: key,
      expected: c.research,
      correct: false,
      error: err.message,
    };
  }
};

export const summarize = (results) =>
  Object.fromEntries(
    [...new Set(results.map((r) => r.strategy))].map((key) => {
      const rs = results.filter((r) => r.strategy === key);
      const ok = rs.filter((r) => !r.error);
      const sweep = ok.every((r) => r.pResearch != null)
        ? Object.fromEntries(
            THRESHOLDS.map((t) => [
              t,
              ok.filter((r) => r.pResearch >= t === r.expected).length,
            ]),
          )
        : null;
      return [
        key,
        {
          correct: rs.filter((r) => r.correct).length,
          total: rs.length,
          errors: rs.length - ok.length,
          falseResearch: ok.filter((r) => r.needsResearch && !r.expected)
            .length,
          missedResearch: ok.filter((r) => !r.needsResearch && r.expected)
            .length,
          medianMs: median(ok.map((r) => r.ms)),
          sweep,
        },
      ];
    }),
  );

/** Run cases sequentially (one model call at a time, so timings are fair). */
export const runTriageEval = async ({
  strategies = Object.keys(STRATEGIES),
  caseIds = null,
  onResult = null,
} = {}) => {
  const cases = caseIds ? CASES.filter((c) => caseIds.includes(c.id)) : CASES;
  const results = [];
  for (const key of strategies) {
    for (const c of cases) {
      const r = await runOne(key, c);
      results.push(r);
      if (onResult) onResult(r, results);
    }
  }
  window.triageResults = { results, summary: summarize(results) };
  return window.triageResults;
};
window.runTriageEval = runTriageEval;

/* ── Page UI ─────────────────────────────────────────────────── */

const renderStatus = async () => {
  const rows = await Promise.all(
    Object.entries(STRATEGIES).map(async ([key, s]) => {
      const check = s.schema
        ? await checkDecisionAvailability(s.schema)
        : { status: "LanguageModel" };
      return `<li><code>${key}</code> — ${s.label}: ${check.status ?? check.reason}</li>`;
    }),
  );
  $("#status").innerHTML = rows.join("");
};

const renderStrategyPicker = () => {
  $("#strategies").innerHTML = Object.entries(STRATEGIES)
    .map(
      ([key, s]) =>
        `<label><input type="checkbox" name="strategy" value="${key}" checked /> ${s.label}</label>`,
    )
    .join("");
};

const renderResults = (results) => {
  const keys = [...new Set(results.map((r) => r.strategy))];
  const byCase = CASES.filter((c) => results.some((r) => r.id === c.id));
  const cell = (r) => {
    if (!r) return "<td></td>";
    if (r.error) return `<td class="bad" title="${r.error}">error</td>`;
    const p = r.pResearch != null ? ` ${r.pResearch.toFixed(2)}` : "";
    return `<td class="${r.correct ? "good" : "bad"}" title="${r.reason} (${r.ms}ms)">${verdict(r.needsResearch)}${p}</td>`;
  };
  $("#results").innerHTML = `
    <thead><tr><th>Case</th><th>Message</th><th>Expected</th>${keys
      .map((k) => `<th>${STRATEGIES[k].label}</th>`)
      .join("")}</tr></thead>
    <tbody>${byCase
      .map(
        (c) =>
          `<tr><td><code>${c.id}</code>${c.source === "authored" ? "" : " ●"}</td><td>${c.message}</td><td>${verdict(c.research)}</td>${keys
            .map((k) =>
              cell(results.find((r) => r.id === c.id && r.strategy === k)),
            )
            .join("")}</tr>`,
      )
      .join("")}</tbody>`;

  const summary = summarize(results);
  $("#summary").innerHTML = Object.entries(summary)
    .map(
      ([k, s]) =>
        `<li><strong>${STRATEGIES[k].label}</strong>: ${s.correct}/${s.total} correct, ${s.falseResearch} unneeded research, ${s.missedResearch} missed research, ${s.errors} errors, median ${s.medianMs ?? "–"}ms${
          s.sweep
            ? `<br />by p(research) threshold: ${Object.entries(s.sweep)
                .map(([t, n]) => `${t} → ${n}`)
                .join(", ")}`
            : ""
        }</li>`,
    )
    .join("");
};

$("#run").addEventListener("click", async () => {
  const strategies = [
    ...document.querySelectorAll("input[name=strategy]:checked"),
  ].map((el) => el.value);
  $("#run").disabled = true;
  $("#progress").textContent = "Running…";
  const total = strategies.length * CASES.length;
  try {
    await runTriageEval({
      strategies,
      onResult: (r, results) => {
        $("#progress").textContent = `${results.length}/${total}`;
        renderResults(results);
      },
    });
    $("#progress").textContent = "Done";
  } finally {
    $("#run").disabled = false;
  }
});

$("#copy").addEventListener("click", () =>
  navigator.clipboard.writeText(
    JSON.stringify(window.triageResults ?? {}, null, 2),
  ),
);

$("#count").textContent = CASES.length;
renderStrategyPicker();
renderStatus();
