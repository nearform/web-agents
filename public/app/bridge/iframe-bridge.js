/* global window:false, document:false, console:false, setTimeout:false, clearTimeout:false */
import { debug } from "../util/debug.js";
import { config } from "../config.js";

const IFRAME_SRC = `${config.vectorSearchOrigin}/public/`;

let iframe = null;
let messageId = 0;
const pending = new Map();
let readyResolve = null;

const onMessage = (event) => {
  if (event.origin !== config.vectorSearchOrigin) return;
  const { type, id } = event.data || {};

  // iframe-server signals it's ready
  if (type === "mcp:ready") {
    debug("iframe-bridge", "Received mcp:ready from iframe");
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
    return;
  }

  if (id != null && pending.has(id)) {
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    if (type === "mcp:tool-error") {
      reject(new Error(event.data.error));
    } else {
      resolve(event.data);
    }
  }
};

const sendMessage = (message) => {
  return new Promise((resolve, reject) => {
    if (!iframe?.contentWindow) {
      reject(new Error("Iframe not connected"));
      return;
    }
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    iframe.contentWindow.postMessage(
      { ...message, id },
      config.vectorSearchOrigin,
    );
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Iframe request timed out"));
      }
    }, config.timeouts.bridgeRequestMs);
  });
};

export const initBridge = () => {
  return new Promise((resolve) => {
    window.addEventListener("message", onMessage);

    // Wait for mcp:ready from the iframe-server (not just iframe load)
    const readyPromise = new Promise((r) => {
      readyResolve = r;
    });

    iframe = document.createElement("iframe");
    iframe.src = IFRAME_SRC;
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    iframe.addEventListener("error", () => {
      console.warn("[iframe-bridge] Failed to load iframe");
      readyResolve = null;
      resolve();
    });

    // Resolve when iframe-server sends mcp:ready, or timeout after 15s
    const timeout = setTimeout(() => {
      console.warn("[iframe-bridge] Timed out waiting for mcp:ready");
      readyResolve = null;
      resolve();
    }, config.timeouts.bridgeReadyMs);

    readyPromise.then(() => {
      clearTimeout(timeout);
      console.log("[iframe-bridge] iframe-server ready");
      resolve();
    });
  });
};

export const discoverTools = async () => {
  try {
    const response = await sendMessage({ type: "mcp:list-tools" });
    debug("iframe-bridge", "Discovered tools:", response.tools);
    return response.tools || [];
  } catch (err) {
    console.warn("[iframe-bridge] Tool discovery failed:", err.message);
    return [];
  }
};

export const callTool = async (name, args) => {
  debug("iframe-bridge", "callTool:", name, args);
  const response = await sendMessage({
    type: "mcp:call-tool",
    name,
    args,
  });
  debug(
    "iframe-bridge",
    "callTool result:",
    name,
    JSON.stringify(response.result).slice(0, 200),
  );
  return response.result;
};
