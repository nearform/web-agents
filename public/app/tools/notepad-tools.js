let notepadCallback = null;
let notepadContent = "";

export const setNotepadCallback = (cb) => {
  notepadCallback = cb;
};

export const getNotepadContent = () => notepadContent;

export const updateNotepad = (content) => {
  notepadContent = content;
  if (notepadCallback) notepadCallback(content);
};

const jsonContent = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

export const notepadTools = [
  {
    name: "take_notes",
    description:
      "Write content to the shared notepad. Replaces any existing notepad content.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The text content to write to the notepad. Pass an empty string to clear.",
        },
      },
      required: ["content"],
    },
    annotations: { readOnlyHint: false },
    execute: async ({ content } = {}) => {
      if (content === undefined) {
        return jsonContent({ success: false, error: "content is required" });
      }
      if (typeof content !== "string") {
        return jsonContent({
          success: false,
          error: "content must be a string",
        });
      }
      updateNotepad(content);
      return jsonContent({ success: true, notepadLength: content.length });
    },
  },
  {
    name: "read_notes",
    description: "Read the current content of the shared notepad.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: { readOnlyHint: true },
    execute: async () => {
      return jsonContent({ success: true, content: getNotepadContent() });
    },
  },
];
