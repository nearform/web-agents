let notepadCallback = null;
let notepadContent = "";

export const setNotepadCallback = (cb) => {
  notepadCallback = cb;
};

export const getNotepadContent = () => notepadContent;

const updateNotepad = (content) => {
  notepadContent = content;
  if (notepadCallback) notepadCallback(content);
};

export const notepadTools = [
  {
    name: "take_notes",
    description:
      "Append notes to the shared notepad. Use this to write summaries, key findings, or formatted content. Content is appended to existing notes.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The text content to append to the notepad",
        },
      },
      required: ["content"],
    },
    execute: async ({ content }) => {
      const updated = notepadContent
        ? notepadContent + "\n\n" + content
        : content;
      updateNotepad(updated);
      return { success: true, notepadLength: updated.length };
    },
  },
  {
    name: "clear_notes",
    description: "Clear all content from the shared notepad.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      updateNotepad("");
      return { success: true };
    },
  },
];
