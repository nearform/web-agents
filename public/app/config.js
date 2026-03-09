/* global window:false */
const isLocalDev =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export const config = {
  vectorSearchOrigin: isLocalDev
    ? "http://localhost:4600"
    : "https://nearform.github.io",
  vectorSearchPath: isLocalDev ? "/public/" : "/vector-search-web/",
  timeouts: {
    promptMs: 60_000,
    bridgeRequestMs: 30_000,
    bridgeReadyMs: 15_000,
  },
  agents: {
    maxIterations: 3,
    maxSearchPosts: 8,
    maxResultTokens: 2000,
    maxExcerptChars: 800,
    maxCoordinatorRetries: 1,
  },
  context: {
    warnPct: 80,
    criticalPct: 90,
    charsPerToken: 4,
    retryReduction: 0.5,
    resultTokenReserve: 100,
  },
};
