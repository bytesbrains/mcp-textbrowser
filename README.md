# @bytesbrains/mcp-textbrowser

[![npm version](https://img.shields.io/npm/v/@bytesbrains/mcp-textbrowser)](https://www.npmjs.com/package/@bytesbrains/mcp-textbrowser)
[![license](https://img.shields.io/npm/l/@bytesbrains/mcp-textbrowser)](./LICENSE)
[![CI](https://github.com/bytesbrains/mcp-textbrowser/actions/workflows/ci.yml/badge.svg)](https://github.com/bytesbrains/mcp-textbrowser/actions/workflows/ci.yml)

> MCP server — text-first headless browser for Claude Code and any MCP host.
> DOM + OCR text maps. **Zero image tokens** by default. **5-15x cheaper** than screenshot-based browser MCPs.

```
browser_navigate(url)             → DOM elements + OCR text   (~200 tokens)
browser_navigate(url, visual=true) → text + PNG               (use for layout/color only)
```

## Why

Every screenshot-based browser MCP sends a PNG to the AI on every action. At 1280×800 that's ~1,300 image tokens per page — 5-15x more expensive than reading the same content as text.

`mcp-textbrowser` captures a screenshot for OCR, extracts the text, then **discards the image**. Only structured DOM elements and OCR text reach the model. Switch to `visual=true` only when you genuinely need pixels (layout checks, color, design review).

| Mode | Tokens per action | When to use |
|---|---|---|
| text-only (default) | ~150–400 | Everything: navigation, forms, data extraction, workflows |
| `visual=true` | ~1,500–3,000 | Layout, colors, CSS, design review |

## Install

**Step 1 — install Chromium** (one-time, ~130MB):

```bash
npx playwright install chromium
```

**Step 2 — add the MCP server:**

### Claude Code (CLI) — one command

```bash
claude mcp add textbrowser -- npx -y @bytesbrains/mcp-textbrowser
```

That's it. Restart Claude Code and the tools are ready.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "textbrowser": {
      "command": "npx",
      "args": ["-y", "@bytesbrains/mcp-textbrowser"]
    }
  }
}
```

Restart Claude Desktop.

### Manual (any MCP host)

Use `command: npx`, `args: ["-y", "@bytesbrains/mcp-textbrowser"]` in your host's MCP server config.

## Tools

| Tool | What it does |
|---|---|
| `browser_navigate` | Open a URL, return page context |
| `browser_click` | Click by CSS selector / XPath / visible text |
| `browser_type` | Fill an input field |
| `browser_scroll` | Scroll page or element into view |
| `browser_screenshot` | Capture current page context |
| `browser_read` | Read current page without navigating |
| `browser_evaluate` | Run JS in the page (safe DOM ops only) |

All tools default to **text-only** — pass `visual: true` to any tool to also receive the PNG.

## Example output

```
Page: https://example.com/
Title: Example Domain
Viewport: 1280x800

Elements (3 interactive of 14 total):
  [1] <a> href="https://iana.org/domains/example" bbox=(133,175,254,195)
      text: "More information..."

OCR (full page screenshot):
Example Domain
This domain is for use in illustrative examples in documents.
You may use this domain in literature without prior coordination or asking for permission.
```

## Requirements

- Node.js 18+
- Chromium: `npx playwright install chromium` (one-time, ~130MB)

## License

MIT © [BytesBrains](https://bytesbrains.io)

---

*Built by Agent, for Agents 🤖*

---

Built and maintained by [BytesBrains](https://bytesbrains.com) — AI automation & agents, engineered to production standards.
*The model proposes, code guarantees.*
