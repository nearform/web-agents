/**
 * Truncate text to fit within a character budget, cutting at the last
 * sentence-ending punctuation or newline boundary to avoid splitting
 * markdown links or mid-word breaks.
 */
const truncateClean = (text, maxLen) => {
  if (text.length <= maxLen) return text;

  const region = text.slice(0, maxLen);

  // Prefer the last sentence boundary (. ! ?) followed by whitespace or end
  const sentenceMatches = [...region.matchAll(/[.!?][)\]"']*(?:\s|$)/g)];
  const lastSentence = sentenceMatches.length
    ? sentenceMatches[sentenceMatches.length - 1]
    : null;
  if (lastSentence && lastSentence.index > maxLen * 0.3) {
    const cut = lastSentence.index + lastSentence[0].trimEnd().length;
    return text.slice(0, cut).trimEnd() + "…";
  }

  // Fall back to last newline
  const newlineEnd = region.lastIndexOf("\n");
  if (newlineEnd > maxLen * 0.3) {
    return text.slice(0, newlineEnd).trimEnd() + "…";
  }

  // Last resort: cut at last space (avoids mid-word / mid-URL)
  const spaceEnd = region.lastIndexOf(" ");
  if (spaceEnd > maxLen * 0.3) {
    return text.slice(0, spaceEnd).trimEnd() + "…";
  }

  return region + "…";
};

/**
 * Format chat history for inclusion in agent prompts.
 *
 * Excludes the last message (the current user query, passed separately as
 * originalQuery) to avoid duplication. When the formatted result exceeds
 * maxChars, oldest messages are dropped first; a single remaining message
 * is truncated at a clean sentence/newline boundary.
 *
 * @param {Array<{role: string, text: string}>} chatHistory
 * @param {object} [opts]
 * @param {number} [opts.maxChars=12000] Total character budget
 * @returns {string}
 */
export const formatChatHistory = (chatHistory, { maxChars = 12000 } = {}) => {
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

  // Single message over budget — truncate at a clean boundary
  return truncateClean(formatted[0], maxChars);
};

/**
 * Split chat history into earlier conversation and the last assistant
 * response, for prompts where the previous response needs to be a
 * first-class edit target.
 *
 * @param {Array<{role: string, text: string}>} chatHistory
 * @param {object} [opts]
 * @param {number} [opts.maxChars=12000] Budget for earlier history
 * @returns {{ earlier: string, lastResponse: string }}
 */
export const splitChatHistory = (chatHistory, { maxChars = 12000 } = {}) => {
  if (!chatHistory || chatHistory.length < 2) {
    return { earlier: "", lastResponse: "" };
  }

  // Exclude current user query
  const prior = chatHistory.slice(0, -1);

  // Find last assistant message
  let lastAssistantIdx = -1;
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) {
    return {
      earlier: formatChatHistory(chatHistory, { maxChars }),
      lastResponse: "",
    };
  }

  const lastResponse = prior[lastAssistantIdx].text;

  // Format everything before the last assistant message as earlier history
  const olderMessages = prior.slice(0, lastAssistantIdx);
  if (olderMessages.length === 0) {
    return { earlier: "", lastResponse };
  }

  const formatted = olderMessages.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`,
  );

  let joined = formatted.join("\n");
  if (joined.length <= maxChars) {
    return { earlier: joined, lastResponse };
  }

  // Over budget: drop oldest
  while (formatted.length > 1) {
    formatted.shift();
    joined = formatted.join("\n");
    if (joined.length <= maxChars) return { earlier: joined, lastResponse };
  }

  return { earlier: truncateClean(formatted[0], maxChars), lastResponse };
};
