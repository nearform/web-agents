import { marked } from "marked";
import DOMPurify from "dompurify";

export const renderMarkdown = (text) => {
  if (!text) return "";
  return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }));
};
