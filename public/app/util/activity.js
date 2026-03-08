export const ActivityType = {
  START: "start",
  PROMPT: "prompt",
  DELEGATE: "delegate",
  RECEIVED: "received",
  RESPONSE: "response",
  DONE: "done",
  ERROR: "error",
  TOOL_CALL: "tool-call",
  TOOL_RESULT: "tool-result",
  TOOL_ERROR: "tool-error",
  SYSTEM: "system",
};

export const createEmitter = (agentName, onActivity) => (type, detail) => {
  if (onActivity) {
    onActivity({ agent: agentName, type, detail, timestamp: Date.now() });
  }
};
