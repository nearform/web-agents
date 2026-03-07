/* global console:false */
import { debug } from "../util/debug.js";

const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

/**
 * Try to fix common JSON issues from small models:
 * - Unescaped newlines inside string values
 * - Trailing commas
 */
const tryParseJson = (raw) => {
  // First try raw
  try {
    return JSON.parse(raw);
  } catch {
    // noop
  }

  // Try fixing unescaped newlines inside JSON string values
  // Replace actual newlines that appear between quotes with \n
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

  // Last resort: try to extract name and args separately
  const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
  const argsMatch = raw.match(/"args"\s*:\s*(\{[\s\S]*\})\s*$/);
  if (nameMatch) {
    const result = { name: nameMatch[1], args: {} };
    if (argsMatch) {
      try {
        result.args = JSON.parse(argsMatch[1]);
      } catch {
        // If args has a content field, extract it as raw text
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

export const parseToolCalls = (text) => {
  const calls = [];
  let match;
  TOOL_CALL_REGEX.lastIndex = 0;

  while ((match = TOOL_CALL_REGEX.exec(text)) !== null) {
    const raw = match[1].trim();
    debug("tool-parser", "Raw tool_call block:", raw);

    const parsed = tryParseJson(raw);
    if (parsed?.name) {
      calls.push({
        name: parsed.name,
        args: parsed.args || {},
      });
      debug("tool-parser", "Parsed tool call:", parsed.name, parsed.args);
    } else {
      console.warn("[tool-parser] Failed to parse tool_call:", raw);
    }
  }

  // Fallback: check for JSON-like tool invocations without XML tags
  // e.g. model outputs: {"name": "take_notes", "args": {...}}
  if (calls.length === 0 && !hasToolCalls(text)) {
    const jsonPattern =
      /\{\s*"name"\s*:\s*"(take_notes|clear_notes|search_nearform_knowledge)"[\s\S]*?\}/g;
    let jsonMatch;
    while ((jsonMatch = jsonPattern.exec(text)) !== null) {
      const parsed = tryParseJson(jsonMatch[0]);
      if (parsed?.name) {
        debug("tool-parser", "Fallback parsed tool call:", parsed.name);
        calls.push({ name: parsed.name, args: parsed.args || {} });
      }
    }
  }

  return calls;
};

export const hasToolCalls = (text) => {
  return /<tool_call>/.test(text);
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
