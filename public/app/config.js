export const config = {
  vectorSearchOrigin: "http://localhost:4600",
  timeouts: {
    promptMs: 60_000,
    bridgeRequestMs: 30_000,
    bridgeReadyMs: 15_000,
  },
  agents: {
    maxIterations: 3,
    maxSearchPosts: 5,
    maxResultTokens: 1000,
  },
  context: {
    warnPct: 80,
    criticalPct: 90,
    charsPerToken: 4,
    retryReduction: 0.5,
    resultTokenReserve: 100,
  },
};
