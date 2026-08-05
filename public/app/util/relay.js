/* global WebSocket:false, document:false, window:false, console:false, setTimeout:false, clearTimeout:false, URLSearchParams:false */

// Version lives in the importmap alongside every other pin.
//
// This has to stay a script tag rather than `await import()`: embed.js is an
// IIFE with no exports that reads its `data-*` config off
// `document.currentScript`, which is null in a module — losing the config and
// falling back to an unversioned widget URL. So resolve the specifier through
// the importmap, then load it the way the package expects.
// https://docs.mcp-b.ai/packages/webmcp-local-relay/reference
const EMBED_SPECIFIER = "@mcp-b/webmcp-local-relay/embed";

// The relay binds the first free port in 9333-9348, so a second instance (or a
// busy 9333) lands elsewhere. Override with ?relayHost= / ?relayPort=.
const params = new URLSearchParams(window.location.search);
const RELAY_HOST = params.get("relayHost") || "127.0.0.1";
const RELAY_PORT = params.get("relayPort") || "9333";
const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;
const PROBE_TIMEOUT_MS = 600;

/**
 * Check whether a local WebMCP relay is listening, without loading the embed.
 *
 * Left to itself the widget discovers the relay by scanning 9333-9348 on both
 * 127.0.0.1 and [::1] — 32 WebSocket attempts, retried on a backoff — so with no
 * relay running it floods the console. One probe up front keeps that to a line.
 */
const relayIsUp = () =>
  new Promise((resolve) => {
    let socket;
    let settled = false;
    const finish = (up) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* never opened */
      }
      resolve(up);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    try {
      socket = new WebSocket(RELAY_URL, ["webmcp-discovery.v1", "webmcp.v1"]);
      socket.addEventListener("open", () => finish(true), { once: true });
      socket.addEventListener("error", () => finish(false), { once: true });
      socket.addEventListener("close", () => finish(false), { once: true });
    } catch {
      finish(false);
    }
  });

/**
 * Load the local relay embed, which bridges this page's WebMCP tools to an
 * external MCP client (Claude Desktop and friends). Purely optional — the demo
 * itself never talks to the relay — so a missing one is logged, not an error.
 */
export const initLocalRelay = async () => {
  if (!(await relayIsUp())) {
    console.info(
      `[webmcp-relay] No local relay on ${RELAY_URL} — skipping MCP client bridge. ` +
        `Start one with: npx @mcp-b/webmcp-local-relay`,
    );
    return false;
  }
  let embedSrc;
  try {
    embedSrc = import.meta.resolve(EMBED_SPECIFIER);
  } catch {
    console.warn(
      `[webmcp-relay] "${EMBED_SPECIFIER}" is missing from the importmap — skipping MCP client bridge.`,
    );
    return false;
  }

  const script = document.createElement("script");
  script.src = embedSrc;
  // Point the widget straight at the endpoint we just verified, so it connects
  // instead of falling back to scanning the range.
  script.dataset.relayHost = RELAY_HOST;
  script.dataset.relayPort = RELAY_PORT;
  document.body.appendChild(script);
  return true;
};
