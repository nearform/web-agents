# Web Agents

An experiment in on-device, in-browser AI agents using [WebMCP](https://github.com/webmachinelearning/webmcp) tools and the [Chrome Prompt API](https://developer.chrome.com/docs/extensions/ai/prompt-api) AI models. Search, research, and create answers/artifacts around Nearform's [articles](https://nearform.com/insights/) and [case studies](https://nearform.com/work/) entirely in the browser!

## What it is

Three AI agents collaborate entirely in the browser — no server-side LLM calls:

- **Coordinator**: triages user questions and decides whether new research is needed
- **Researcher**: searches a knowledge base via a cross-origin WebMCP tool
- **Writer**: synthesises research into a streamed response with citations

Tools are shared across origins using an iframe-based transport bridge from [@mcp-b/transports](https://npmx.dev/package/@mcp-b/transports) -- an early way to experiment since WebMCP doesn't have realy browser transport suppor yet. A hidden iframe hosts a remote tool server; the parent page discovers and calls tools over JSON-RPC. Local tools (notepad) and remote tools (search) are unified in a single registry.

Some other neat things:

- **Use the tools**: in the Tools area, you can click on any registered tool and directly invoke it.
- **See agent data**: in the Agent Activity pane, click into agent actions to see full data, prompts, etc.

## Prerequisites

- **Chrome** with the Prompt API / Language Model API enabled (provides the on-device LLM)
- _Optional_: the [Decisions API](https://github.com/explainers-by-googlers/decisions-api) (`DecisionModel`, `chrome://flags/#decisions-api`). When present, the Coordinator uses it to decide whether a follow-up needs new research; otherwise it asks the Prompt API. Pick a strategy with `?triage=prompt-api|decision-choice|decision-booleans`, and compare them on labelled cases at `/public/tests/triage.html`.
- **[vector-search-web](https://github.com/nearform/vector-search-web)** provides the `search_nearform_knowledge` tool. (Runs on `http://localhost:4600` in localdev and https://nearform.github.io/vector-search-web/ in production).

## Development

Run the development server:

```sh
# Navigate to http://localhost:4610/public
npm run dev
```

## License

All code in this project is licensed under the MIT License — see the [LICENSE](./LICENSE.txt) file for details.
