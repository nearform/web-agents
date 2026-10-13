import {
  initBridge,
  discoverTools,
  callTool as callRemoteTool,
} from "./iframe-bridge.js";
import { TOOLS } from "../tools/index.js";
import { debug } from "../util/debug.js";
import { executeTool, getModelContext } from "../util/platform.js";

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

  await registerLocalToolsWithWebMcp();

  return listTools();
};

export const isConnected = () => connected;

export const listTools = () => {
  const remote = remoteTools.map((t) => ({
    ...t,
    source: "remote",
    connected,
  }));
  const local = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    source: "local",
    connected: true,
  }));
  return [...remote, ...local];
};

// Unwrap MCP tool result: parse the JSON-encoded result, then extract the text payload
const unwrapContent = (result) => {
  const parsed = typeof result === "string" ? JSON.parse(result) : result;
  const text = parsed?.content?.[0]?.text;
  return text ? JSON.parse(text) : parsed;
};

export const callTool = async (name, args) => {
  debug("tool-registry", "callTool:", name, args);
  const localTool = TOOLS.find((t) => t.name === name);
  if (localTool) {
    // Prefer `executeTool` to gut check tooling invocation through WebMCP
    // (native or polyfilled). Fall back to invoking the tool directly when
    // WebMCP is unavailable or the tool did not register.
    const modelContext = getModelContext();
    const registeredTool = modelContext
      ? (await modelContext.getTools()).find((t) => t.name === name)
      : null;
    const result = registeredTool
      ? await executeTool(modelContext, registeredTool, args ?? {})
      : await localTool.execute(args ?? {});
    debug("tool-registry", "Local tool result:", name, result);
    return unwrapContent(result);
  }

  const remoteTool = remoteTools.find((t) => t.name === name);
  if (remoteTool) {
    return callRemoteTool(name, args);
  }

  throw new Error(`Unknown tool: ${name}`);
};

const registerLocalToolsWithWebMcp = async () => {
  const modelContext = getModelContext();
  if (!modelContext) return;

  for (const tool of TOOLS) {
    await modelContext.registerTool(tool);
  }
  debug.info("tool-registry", "Registered local tools with WebMCP");
};
