/* global console:false, URLSearchParams:false, window:false */

const params = new URLSearchParams(window.location.search);
const DEBUG = params.has("debug");

export const debug = (tag, ...args) => {
  if (!DEBUG) return;
  console.log(`[${tag}]`, ...args);
};
