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

export const getElements = (event) => {
  const propNames = Object.getOwnPropertyNames(
    event.currentTarget.elements,
  ).filter(([k]) => !/^[0-9]+$/.test(k.toString()));

  return Object.fromEntries(
    propNames.map((k) => {
      const v = event.currentTarget.elements[k];
      if (v.type === "number") {
        return [k, v.valueAsNumber];
      }
      return [k, v.value.trim()];
    }),
  );
};
