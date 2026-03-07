/* global console:false */
import { debug } from "../util/debug.js";

/**
 * Try to fix common JSON issues from small models:
 * - Unescaped newlines inside string values
 * - Trailing commas
 */
const tryParseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    // noop
  }

  // Fix unescaped newlines outside of quoted strings
  let fixed = raw.replace(
    /("(?:[^"\\]|\\.)*")|(\n)/g,
    (match, quoted, newline) => {
      if (quoted) return quoted;
      if (newline) return " ";
      return match;
    },
  );
  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(fixed);
  } catch {
    // noop
  }

  // Last resort: extract name and args separately via regex
  const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
  const argsMatch = raw.match(/"args"\s*:\s*(\{[\s\S]*\})\s*$/);
  if (nameMatch) {
    const result = { name: nameMatch[1], args: {} };
    if (argsMatch) {
      try {
        result.args = JSON.parse(argsMatch[1]);
      } catch {
        const contentMatch = argsMatch[1].match(
          /"content"\s*:\s*"([\s\S]*)"\s*\}?$/,
        );
        if (contentMatch) {
          result.args = { content: contentMatch[1].replace(/\\n/g, "\n") };
        }
      }
    }
    return result;
  }

  return null;
};

/**
 * Normalize model output to handle common small-model quirks:
 * - Backtick wrapping: ```tool_call>...``` or `<tool_call>...`
 * - Missing opening <: tool_call>...</tool_call>
 * - Extra whitespace
 */
const normalizeText = (text) => {
  let t = text;
  // Strip backticks wrapping tool_call blocks
  t = t.replace(/`+/g, "");
  // Fix missing opening < on tool_call tags
  t = t.replace(/(?<![<])tool_call>/g, "<tool_call>");
  // Fix missing opening < on /tool_call closing tags
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

  // Fallback: look for JSON objects with a "name" field matching known tools
  if (calls.length === 0) {
    const jsonPattern =
      /\{\s*"name"\s*:\s*"(take_notes|clear_notes|search_nearform_knowledge)"\s*,\s*"args"\s*:\s*\{[^}]*\}\s*\}/g;
    let jsonMatch;
    while ((jsonMatch = jsonPattern.exec(normalized)) !== null) {
      const parsed = tryParseJson(jsonMatch[0]);
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
  return /<tool_call>/.test(normalized);
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
