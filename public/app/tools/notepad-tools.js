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
          description: "The text content to write to the notepad",
        },
      },
      required: ["content"],
    },
    execute: async ({ content } = {}) => {
      if (content === undefined) {
        return { success: false, error: "content is required" };
      }
      updateNotepad(content);
      return { success: true, notepadLength: content.length };
    },
  },
  {
    name: "read_notes",
    description: "Read the current content of the shared notepad.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      return { success: true, content: getNotepadContent() };
    },
  },
];
