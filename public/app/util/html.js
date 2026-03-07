/* global window:false */
import React from "react";
import htm from "htm";

export const html = htm.bind(React.createElement);

export const openTextInNewWindow = (text) => {
  const win = window.open("", "_blank");
  win.document.write("<html><body><pre></pre></body></html>");
  win.document.close();
  win.document.querySelector("pre").innerText = text;
};
