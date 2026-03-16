/**
 * Format chat history for inclusion in agent prompts.
 *
 * Excludes the last message (the current user query, passed separately as
 * originalQuery) to avoid duplication. When the formatted result exceeds
 * maxChars, oldest messages are dropped first; a single remaining message
 * is truncated as a last resort.
 *
 * @param {Array<{role: string, text: string}>} chatHistory
 * @param {object} [opts]
 * @param {number} [opts.maxChars=6000] Total character budget
 * @returns {string}
 */
export const formatChatHistory = (chatHistory, { maxChars = 6000 } = {}) => {
  if (!chatHistory || chatHistory.length < 2) return "";
  // Exclude current user query — it's passed separately as originalQuery
  const prior = chatHistory.slice(0, -1);
  const formatted = prior.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`,
  );

  let joined = formatted.join("\n");
  if (joined.length <= maxChars) return joined;

  // Over budget: drop oldest messages until it fits
  while (formatted.length > 1) {
    formatted.shift();
    joined = formatted.join("\n");
    if (joined.length <= maxChars) return joined;
  }

  // Single message over budget — truncate
  return formatted[0].slice(0, maxChars - 1) + "…";
};
