/* global navigator:false */
import {
  initBridge,
  discoverTools,
  callTool as callRemoteTool,
} from "./iframe-bridge.js";
import { notepadTools } from "../tools/notepad-tools.js";
import { debug } from "../util/debug.js";

let remoteTools = [];
let connected = false;

export const initRegistry = async () => {
  await initBridge();

  try {
    remoteTools = await discoverTools();
    connected = remoteTools.length > 0;
    debug.info(
      "tool-registry",
      `Discovered ${remoteTools.length} remote tools`,
    );
  } catch {
    debug.warn("tool-registry", "Remote tool discovery failed");
  }

  registerLocalToolsWithWebMcp();

  return listTools();
};

export const isConnected = () => connected;

export const listTools = () => {
  const remote = remoteTools.map((t) => ({
    ...t,
    source: "remote",
    connected,
  }));
  const local = notepadTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    source: "local",
    connected: true,
  }));
  return [...remote, ...local];
};

export const callTool = async (name, args) => {
  debug("tool-registry", "callTool:", name, args);
  const localTool = notepadTools.find((t) => t.name === name);
  if (localTool) {
    const result = await localTool.execute(args);
    debug("tool-registry", "Local tool result:", name, result);
    return result;
  }

  const remoteTool = remoteTools.find((t) => t.name === name);
  if (remoteTool) {
    return callRemoteTool(name, args);
  }

  throw new Error(`Unknown tool: ${name}`);
};

const registerLocalToolsWithWebMcp = () => {
  if (!("modelContext" in navigator)) return;

  for (const tool of notepadTools) {
    navigator.modelContext.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: false },
      execute: async (input) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(await tool.execute(input)),
          },
        ],
      }),
    });
  }
  debug.info("tool-registry", "Registered local tools with WebMCP");
};
