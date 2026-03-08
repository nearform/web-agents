import { callTool } from "../bridge/tool-registry.js";

/**
 * Convert registry tool descriptors into self-contained objects
 * matching the future Prompt API tool shape (with execute()).
 */
export const makeTools = (toolDescriptors, { transformResult } = {}) =>
  toolDescriptors.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    async execute(args) {
      const raw = await callTool(t.name, args);
      const result = transformResult ? transformResult(raw) : raw;
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  }));
