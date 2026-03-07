export const config = {
  vectorSearchOrigin: "http://localhost:4600",
  timeouts: {
    promptMs: 120_000,
    bridgeRequestMs: 30_000,
    bridgeReadyMs: 15_000,
  },
  agents: {
    maxIterations: 3,
    maxSearchPosts: 8,
  },
};
