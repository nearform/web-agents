// Labelled triage cases: given a research notepad, the conversation so far and
// a new user message, should the coordinator research (true) or reuse (false)?
//
// Labels follow TRIAGE_BASE in app/agents/prompts.js: reuse when the topic is
// even partly covered or the user wants a rewrite/reformat; research for a
// genuinely new topic or an explicit request to search.
//
// `source: "observed"` cases came from real runs; `"authored"` ones were
// written to cover the rules and need a human check of the label.

const SHELL_TOOLS_NOTEPAD = `## Summary

Nearform's content indicates that the effectiveness of a terminal coding agent is strongly related to leveraging the **Unix philosophy**, which emphasizes manipulating text streams and files using composable command-line tools. Tools that support this ecosystem, such as those utilized by Claude Code, are essential for this effectiveness [Terminal velocity: the shell tools that make Claude Code fly](https://nearform.com/digital-community/terminal-velocity-the-shell-tools-that-make-claude-code-fly/).

Additionally, agentic workflows gain significant benefits from tools that enable AI agents to execute terminal commands and react to their outputs. This allows agents to shift from making reactive suggestions to performing proactive, goal-oriented actions [Battle of the AI agents](https://nearform.com/digital-community/battle-of-the-ai-agents/).

Other related concepts discussed include:
*   **Agent Mode:** AI tools can transition from simple autocompletion to proactive agents capable of loading codebases, navigating files, making edits, and running terminal commands to respond to project context [Battle of the AI agents](https://nearform.com/digital-community/battle-of-the-ai-agents).
*   **Container Approach:** Using containers can secure agentic workflows by providing instant onboarding and eliminating "environment drift" through a fully configured and consistent environment for AI agents [Securing agentic workflows: the container approach](https://nearform.com/digital-community/securing-agentic-workflows-the-container-approach/).

## Posts

*   **Terminal velocity: the shell tools that make Claude Code fly**: This post highlights that Claude Code's success is driven by its 'form factor' running in the terminal and its capitalization on the Unix philosophy of using composable tools for text stream and file manipulation. [Terminal velocity: the shell tools that make Claude Code fly](https://nearform.com/digital-community/terminal-velocity-the-shell-tools-that-make-claude-code-fly/)
*   **Battle of the AI agents**: This discussion covers 'agent mode,' where AI tools evolve from basic autocompletion into proactive agents that can handle tasks like loading codebases, navigating files, making edits, and running terminal commands based on project context. [Battle of the AI agents](https://nearform.com/digital-community/battle-of-the-ai-agents)
*   **Securing agentic workflows: the container approach**: This resource explores operations on the same foundation, suggesting that using containers helps eliminate 'environment drift' by ensuring AI agents have a fully configured, consistent environment for instant onboarding. [Securing agentic workflows: the container approach](https://nearform.com/digital-community/securing-agentic-workflows-the-container-approach/)

## Citations

*   Terminal velocity: the shell tools that make Claude Code fly [Terminal velocity: the shell tools that make Claude Code fly](https://nearform.com/digital-community/terminal-velocity-the-shell-tools-that-make-claude-code-fly/)
*   Battle of the AI agents [Battle of the AI agents](https://nearform.com/digital-community/battle-of-the-ai-agents)
*   Securing agentic workflows: the container approach [Securing agentic workflows: the container approach](https://nearform.com/digital-community/securing-agentic-workflows-the-container-approach/)`;

const SHELL_TOOLS_HISTORY = [
  {
    role: "user",
    text: "Which shell tools make a terminal coding agent more effective?",
  },
  {
    role: "assistant",
    text: "To make your terminal coding agent effective, focus on leveraging the Unix philosophy by using composable command-line tools for text stream and file manipulation. Agents get even more powerful when they can run terminal commands and react to those outputs to take proactive actions instead of just suggesting things. [Terminal velocity: the shell tools that make Claude Code fly](https://nearform.com/digital-community/terminal-velocity-the-shell-tools-that-make-claude-code-fly/), [Battle of the AI agents](https://nearform.com/digital-community/battle-of-the-ai-agents), [Securing agentic workflows: the container approach](https://nearform.com/digital-community/securing-agentic-workflows-the-container-approach/)",
  },
];

// Authored to match the Writer's format; post titles are illustrative apart
// from the WebMCP one.
const ON_DEVICE_NOTEPAD = `## Summary

Nearform is exploring **on-device AI** that runs entirely in the browser, with no server-side model calls. Its experiments pair Chrome's built-in **Prompt API** (Gemini Nano) with **browser-based vector search**: post embeddings are computed with Transformers.js and searched locally, so queries and data never leave the device [Vector search in the browser](https://nearform.com/digital-community/vector-search-in-the-browser/).

The same work exposes search as a tool through **WebMCP**, so in-browser agents can call it like any other tool [WebMCP: turning web pages into tools for AI agents](https://nearform.com/digital-community/webmcp-turning-web-pages-into-tools-for-ai-agents/). Trade-offs discussed include model download size, WebGPU availability and the limited context window of small on-device models [On-device AI in the browser](https://nearform.com/digital-community/on-device-ai-in-the-browser/).

## Posts

*   **Vector search in the browser**: Builds a semantic search over Nearform articles that runs client-side, using a small embedding model in Transformers.js (WebGPU with a WebAssembly fallback) and an in-memory index. Privacy and zero hosting cost are the main benefits. [Vector search in the browser](https://nearform.com/digital-community/vector-search-in-the-browser/)
*   **WebMCP: turning web pages into tools for AI agents**: Shows how a page can register tools that AI agents call, including a cross-origin iframe bridge for sharing tools between sites. [WebMCP: turning web pages into tools for AI agents](https://nearform.com/digital-community/webmcp-turning-web-pages-into-tools-for-ai-agents/)
*   **On-device AI in the browser**: Surveys Chrome's built-in AI APIs and open-weight models running on WebGPU, covering download size, memory limits on phones and when on-device beats cloud. [On-device AI in the browser](https://nearform.com/digital-community/on-device-ai-in-the-browser/)

## Citations

*   Vector search in the browser [Vector search in the browser](https://nearform.com/digital-community/vector-search-in-the-browser/)
*   WebMCP: turning web pages into tools for AI agents [WebMCP: turning web pages into tools for AI agents](https://nearform.com/digital-community/webmcp-turning-web-pages-into-tools-for-ai-agents/)
*   On-device AI in the browser [On-device AI in the browser](https://nearform.com/digital-community/on-device-ai-in-the-browser/)`;

const ON_DEVICE_HISTORY = [
  {
    role: "user",
    text: "How is Nearform using on-device AI and browser-based vector search?",
  },
  {
    role: "assistant",
    text: "Nearform runs semantic search entirely in the browser, embedding articles with Transformers.js and searching them locally, and pairs it with Chrome's built-in Prompt API so nothing leaves the device. It also exposes that search to agents as a WebMCP tool. [Vector search in the browser](https://nearform.com/digital-community/vector-search-in-the-browser/), [WebMCP: turning web pages into tools for AI agents](https://nearform.com/digital-community/webmcp-turning-web-pages-into-tools-for-ai-agents/)",
  },
];

const shell = (id, message, research, extra = {}) => ({
  id,
  notepad: SHELL_TOOLS_NOTEPAD,
  history: SHELL_TOOLS_HISTORY,
  message,
  research,
  source: "authored",
  ...extra,
});

const onDevice = (id, message, research, extra = {}) => ({
  id,
  notepad: ON_DEVICE_NOTEPAD,
  history: ON_DEVICE_HISTORY,
  message,
  research,
  source: "authored",
  ...extra,
});

export const CASES = [
  shell(
    "shell-secure-tool",
    "What's a tool I can use make my agents more secure?",
    false,
    {
      source: "observed",
      note: "Containers for agent security are covered. Borderline.",
    },
  ),
  shell("shell-email", "Turn that into a short email to my team", false),
  shell("shell-shorter", "Make it shorter", false),
  shell("shell-webpack", "Tell me about Nearform's webpack work", true),
  shell(
    "shell-search-rn",
    "Search for Nearform posts about React Native",
    true,
  ),
  shell(
    "shell-which-containers",
    "Which of those posts talks about containers?",
    false,
  ),
  shell(
    "shell-a11y",
    "What does Nearform say about accessibility testing?",
    true,
  ),
  shell("shell-find-more", "Can you find more articles on Claude Code?", true, {
    note: "Covered topic, but an explicit ask to find more.",
  }),
  shell(
    "shell-agent-mode",
    "How does agent mode differ from autocomplete?",
    false,
  ),
  shell(
    "shell-non-technical",
    "Rewrite this for a non-technical audience",
    false,
  ),
  onDevice(
    "device-vector-browser",
    "Can I do vector search in a browser?",
    false,
    { source: "observed" },
  ),
  onDevice("device-webpack", "Tell me about Nearform's webpack work", true, {
    source: "observed",
  }),
  onDevice("device-bullets", "Summarize the key points as bullets", false),
  onDevice(
    "device-embedding-models",
    "What models run in the browser for embeddings?",
    false,
  ),
  onDevice("device-banking", "Who are Nearform's clients in banking?", true),
  onDevice(
    "device-webgpu-lookup",
    "Look up anything Nearform has written about WebGPU",
    true,
    { note: "Partly covered, but an explicit ask to look up." },
  ),
  onDevice(
    "device-privacy",
    "Is this approach private? Does data leave the device?",
    false,
  ),
  onDevice("device-graphql", "What about Nearform's work with GraphQL?", true),
];
