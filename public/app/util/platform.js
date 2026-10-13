/* global navigator:false,document:false */
import { installWebMCP } from "@mcp-b/webmcp-polyfill";

let nativeWebMcp = false;

/**
 * Install the WebMCP polyfill, noting first whether the browser already has a
 * native `document.modelContext` (the polyfill leaves a native one in place).
 */
export const initWebMcp = () => {
  nativeWebMcp = !!document.modelContext;
  installWebMCP();
};

export const getModelContext = () => document.modelContext;

/**
 * Detect platform capabilities for the status modal.
 * @param {{ available: boolean, reason?: string }} apiCheck — result of checkAvailability()
 * @returns {{ languageModel: { available: boolean, reason?: string }, webMcp: { native: boolean, polyfilled: boolean, chromeVersion: number|null }, isChrome: boolean }}
 */
export function detectPlatformStatus(apiCheck) {
  // LanguageModel API status — reuse the check that was already performed
  const languageModel = {
    available: apiCheck.available,
    reason: apiCheck.reason ?? null,
  };

  // Chrome version from UA
  const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)/);
  const chromeVersion = chromeMatch ? parseInt(chromeMatch[1], 10) : null;
  const isChrome = chromeVersion !== null;

  // WebMCP detection
  const modelContext = getModelContext();
  const native = !!modelContext && nativeWebMcp;
  const polyfilled = !!modelContext && !nativeWebMcp;

  return {
    languageModel,
    webMcp: { native, polyfilled, chromeVersion },
    isChrome,
  };
}

// Chrome 154 and earlier take `executeTool` arguments as a JSON string and
// reject an object with "Failed to parse input arguments" before the tool
// runs; 155+ takes the object. Nothing else tells them apart, so try the object
// and, on that refusal, retry with the string and keep using it.
const STRING_ARGS_REFUSAL = /parse input arguments/i;
let stringArgs = false;

/** `modelContext.executeTool`, with `args` in whichever form the host takes. */
export const executeTool = async (modelContext, tool, args = {}) => {
  if (!stringArgs) {
    try {
      return await modelContext.executeTool(tool, args);
    } catch (err) {
      if (!STRING_ARGS_REFUSAL.test(err?.message ?? "")) throw err;
      stringArgs = true;
    }
  }
  return modelContext.executeTool(tool, JSON.stringify(args));
};
