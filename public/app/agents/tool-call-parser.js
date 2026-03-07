export const formatToolSchemas = (tools) => {
  return tools
    .map(
      (t) =>
        `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.inputSchema, null, 2)}`,
    )
    .join("\n\n");
};

export const formatToolResult = (name, result) => {
  return `<tool_result name="${name}">${JSON.stringify(result)}</tool_result>`;
};
