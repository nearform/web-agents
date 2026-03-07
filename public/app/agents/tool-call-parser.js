/* global console:false */
import { debug } from "../util/debug.js";

/**
 * Try to parse JSON, handling common small-model issues:
 * - Unescaped newlines inside string values
 * - Trailing commas
 * - Multiline content strings
 */
const tryParseJson = (raw) => {
  // Attempt 1: raw parse
  try {
    return JSON.parse(raw);
  } catch {
    // noop
  }

  // Attempt 2: escape literal newlines/tabs inside the string
  const escaped = raw
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  // Also remove trailing commas
  const cleaned = escaped.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(cleaned);
  } catch {
    // noop
  }

  // Attempt 3: extract name and args via regex
  const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
  if (!nameMatch) return null;

  const result = { name: nameMatch[1], args: {} };

  // Try to find args object — use everything after "args": { until the last }
  const argsStart = raw.indexOf('"args"');
  if (argsStart !== -1) {
    const braceStart = raw.indexOf("{", argsStart + 6);
    if (braceStart !== -1) {
      // Take from the { to the end, trim trailing } from the outer object
      let argsRaw = raw.slice(braceStart);
      // Remove trailing outer brace if present
      argsRaw = argsRaw.replace(/\}\s*\}\s*$/, "}");

      try {
        result.args = JSON.parse(argsRaw);
      } catch {
        // For take_notes: extract content as everything between first ":" and last "}"
        const contentStart = argsRaw.indexOf('"content"');
        if (contentStart !== -1) {
          const colonPos = argsRaw.indexOf(":", contentStart);
          if (colonPos !== -1) {
            let val = argsRaw.slice(colonPos + 1).trim();
            // Strip surrounding quotes and trailing }
            val = val.replace(/^\s*"/, "").replace(/"\s*\}?\s*$/, "");
            // Unescape
            val = val.replace(/\\n/g, "\n").replace(/\\"/g, '"');
            if (val) {
              result.args = { content: val };
            }
          }
        }
      }
    }
  }

  debug("tool-parser", "Regex-extracted tool call:", result.name, result.args);
  return result;
};

/**
 * Normalize model output to handle common small-model quirks:
 * - Backtick wrapping
 * - Missing opening <
 */
const normalizeText = (text) => {
  let t = text;
  t = t.replace(/`+/g, "");
  t = t.replace(/(?<![<])tool_call>/g, "<tool_call>");
  t = t.replace(/(?<![<])\/tool_call>/g, "</tool_call>");
  return t;
};

const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export const parseToolCalls = (text) => {
  const normalized = normalizeText(text);

  if (normalized !== text) {
    debug("tool-parser", "Normalized text (was different from raw)");
  }

  const calls = [];
  let match;
  TOOL_CALL_REGEX.lastIndex = 0;

  while ((match = TOOL_CALL_REGEX.exec(normalized)) !== null) {
    const raw = match[1].trim();
    debug("tool-parser", "Raw tool_call block:", raw);

    const parsed = tryParseJson(raw);
    if (parsed?.name) {
      calls.push({ name: parsed.name, args: parsed.args || {} });
      debug("tool-parser", "Parsed tool call:", parsed.name, parsed.args);
    } else {
      console.warn("[tool-parser] Failed to parse tool_call:", raw);
    }
  }

  // Fallback: look for JSON with known tool names outside of tags
  if (calls.length === 0) {
    const namePattern =
      /"name"\s*:\s*"(take_notes|clear_notes|search_nearform_knowledge)"/g;
    let nameMatch;
    while ((nameMatch = namePattern.exec(normalized)) !== null) {
      // Find the enclosing { ... } around this match
      let start = nameMatch.index;
      while (start > 0 && normalized[start] !== "{") start--;
      // Find matching closing brace (handle nesting)
      let depth = 0;
      let end = start;
      for (; end < normalized.length; end++) {
        if (normalized[end] === "{") depth++;
        if (normalized[end] === "}") depth--;
        if (depth === 0) break;
      }
      const jsonStr = normalized.slice(start, end + 1);
      const parsed = tryParseJson(jsonStr);
      if (parsed?.name) {
        debug("tool-parser", "Fallback parsed tool call:", parsed.name);
        calls.push({ name: parsed.name, args: parsed.args || {} });
      }
    }
  }

  if (calls.length === 0) {
    debug(
      "tool-parser",
      "No tool calls found. Raw output:",
      text.slice(0, 500),
    );
  }

  return calls;
};

export const hasToolCalls = (text) => {
  const normalized = normalizeText(text);
  return (
    /<tool_call>/.test(normalized) ||
    /"name"\s*:\s*"(take_notes|clear_notes|search_nearform_knowledge)"/.test(
      normalized,
    )
  );
};

export const formatToolSchemas = (tools) => {
  return tools
    .map(
      (t) =>
        `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.inputSchema, null, 2)}`,
    )
    .join("\n\n");
};

export const formatToolResult = (name, result) => {
  return `<tool_result name="${name}">${JSON.stringify(result)}</tool_result>`;
};
