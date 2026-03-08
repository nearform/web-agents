/* global document:false, setTimeout:false */
import { IframeParentTransport } from "@mcp-b/transports";
import { config } from "../config.js";
import { debug } from "../util/debug.js";

const IFRAME_SRC = `${config.vectorSearchOrigin}/public/`;

let transport = null;
let messageId = 0;
const pending = new Map();

const sendRequest = (method, params) => {
  return new Promise((resolve, reject) => {
    if (!transport) {
      reject(new Error("Transport not initialized"));
      return;
    }
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    transport.send({ jsonrpc: "2.0", id, method, params });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }
    }, config.timeouts.bridgeRequestMs);
  });
};

export const initBridge = async () => {
  const iframe = document.createElement("iframe");
  iframe.src = IFRAME_SRC;
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  await new Promise((resolve, reject) => {
    iframe.addEventListener("load", resolve, { once: true });
    iframe.addEventListener("error", reject, { once: true });
  });

  transport = new IframeParentTransport({
    iframe,
    targetOrigin: config.vectorSearchOrigin,
  });

  transport.onmessage = (message) => {
    const { id, result, error } = message;
    if (id != null && pending.has(id)) {
      const { resolve, reject } = pending.get(id);
      pending.delete(id);
      if (error) {
        reject(new Error(error.message || JSON.stringify(error)));
      } else {
        resolve(result);
      }
    }
  };

  transport.onerror = (err) => {
    debug.warn("iframe-bridge", "Transport error:", err);
  };

  await transport.start();

  try {
    await Promise.race([
      transport.serverReadyPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timed out waiting for iframe server")),
          config.timeouts.bridgeReadyMs,
        ),
      ),
    ]);
    debug.info("iframe-bridge", "iframe-server ready");
  } catch (err) {
    debug.warn("iframe-bridge", err.message);
  }
};

export const discoverTools = async () => {
  try {
    const result = await sendRequest("tools/list", {});
    debug("iframe-bridge", "Discovered tools:", result.tools);
    return result.tools || [];
  } catch (err) {
    debug.warn("iframe-bridge", "Tool discovery failed:", err.message);
    return [];
  }
};

export const callTool = async (name, args) => {
  debug("iframe-bridge", "callTool:", name, args);
  const result = await sendRequest("tools/call", { name, arguments: args });
  debug(
    "iframe-bridge",
    "callTool result:",
    name,
    JSON.stringify(result).slice(0, 200),
  );
  return result;
};
