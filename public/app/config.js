/* global window:false,URLSearchParams:false */
const isLocalDev =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const params = new URLSearchParams(window.location.search);
const parseMs = (key, fallback) => {
  const v = parseInt(params.get(key), 10);
  return v > 0 ? v : fallback;
};

export const config = {
  vectorSearchOrigin: isLocalDev
    ? "http://localhost:4600"
    : "https://nearform.github.io",
  vectorSearchPath: isLocalDev ? "/public/" : "/vector-search-web/",
  timeouts: {
    promptMs: parseMs("promptTimeout", 120_000),
    bridgeRequestMs: parseMs("bridgeTimeout", 30_000),
    bridgeReadyMs: parseMs("bridgeReadyTimeout", 15_000),
  },
  agents: {
    maxIterations: 3,
    maxSearchPosts: 5,
    maxResultTokens: 1200,
    maxExcerptChars: 400,
    maxCoordinatorRetries: 1,
  },
  deepLinkTool: params.get("tool") || null,
  context: {
    warnPct: 80,
    criticalPct: 90,
    charsPerToken: 4,
    retryReduction: 0.5,
    resultTokenReserve: 100,
  },
};
