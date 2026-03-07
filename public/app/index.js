import { html } from "./util/html.js";

export const App = () => {
  return html`
    <div className="container">
      <header className="header">
        <h1>WebMCP Demo</h1>
        <p className="intro">
          ${/* TODO: UPDATE INTRO */ ""} MCP entirely in the browser! ${" "}
          <a
            href="https://github.com/nearform/webmcp-demo"
            target="_blank"
            rel="noopener noreferrer"
            className="intro-github-link"
            aria-label="View on GitHub"
          >
            <i className="ph ph-github-logo"></i>
          </a>
        </p>
      </header>

      <footer className="footer">
        <a
          href="https://www.nearform.com/contact/?utm_source=open-source&utm_medium=banner&utm_campaign=os-project-pages"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://raw.githubusercontent.com/nearform/.github/refs/heads/master/assets/os-banner-green.svg"
            alt="Nearform Open Source"
            className="nearform-banner"
          />
        </a>
      </footer>
    </div>
  `;
};
