/* global console:false, URLSearchParams:false, window:false */

const params = new URLSearchParams(window.location.search);
const DEBUG = params.has("debug");

let activityCallback = null;

export const setDebugActivityCallback = (cb) => {
  activityCallback = cb;
};

const emit = (tag, args) => {
  if (activityCallback) {
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    activityCallback({
      agent: "System",
      type: "system",
      detail: `[${tag}] ${message}`,
      timestamp: Date.now(),
    });
  }
};

export const debug = (tag, ...args) => {
  if (!DEBUG) return;
  console.log(`[${tag}]`, ...args);
};

debug.info = (tag, ...args) => {
  if (DEBUG) console.log(`[${tag}]`, ...args);
  emit(tag, args);
};

debug.warn = (tag, ...args) => {
  if (DEBUG) console.warn(`[${tag}]`, ...args);
  emit(tag, args);
};

debug.error = (tag, ...args) => {
  if (DEBUG) console.error(`[${tag}]`, ...args);
  emit(tag, args);
};
