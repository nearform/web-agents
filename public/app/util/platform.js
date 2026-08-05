/* global navigator:false,document:false */
export const getModelContext = () =>
  document.modelContext ?? navigator.modelContext;

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
  const native = !!(modelContext && !modelContext.__isWebMCPPolyfill);
  const polyfilled = !!(modelContext && modelContext.__isWebMCPPolyfill);

  return {
    languageModel,
    webMcp: { native, polyfilled, chromeVersion },
    isChrome,
  };
}
