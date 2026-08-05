/* global WebSocket:false, document:false, console:false, setTimeout:false, clearTimeout:false */

const RELAY_URL = "ws://127.0.0.1:9333";
// jsdelivr won't serve the embedded HTML as "text/html" so use another CDN.
const EMBED_SRC =
  "https://unpkg.com/@mcp-b/webmcp-local-relay@4.0.0/dist/browser/embed.js";
const PROBE_TIMEOUT_MS = 600;

/**
 * Check whether a local WebMCP relay is listening, without loading the embed.
 *
 * The embed's widget discovers the relay by scanning ports 9333-9348 on both
 * 127.0.0.1 and [::1] — 32 WebSocket attempts, each retried — so when no relay
 * is running it fills the console with failed-connection errors. Probing the
 * default port once first keeps that to a single line.
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
  const script = document.createElement("script");
  script.src = EMBED_SRC;
  document.body.appendChild(script);
  return true;
};
