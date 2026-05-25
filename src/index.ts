/**
 * @bytesbrains/mcp-textbrowser
 *
 * MCP server exposing headless browser tools for Claude Code.
 * DOM + OCR text maps — no image tokens in default mode (10-50x cheaper).
 *
 * Tools:
 *   browser_navigate   — open a URL, return page context
 *   browser_click      — click by selector / xpath / text
 *   browser_type       — fill an input field
 *   browser_scroll     — scroll the page or an element into view
 *   browser_screenshot — capture current page context
 *   browser_read       — read current page without changing it
 *   browser_evaluate   — run JS in the page (safe DOM ops only)
 *
 * Configure in .claude/settings.json:
 *   {
 *     "mcpServers": {
 *       "textbrowser": {
 *         "command": "npx",
 *         "args": ["tsx", "/path/to/pi-ext/mcp-textbrowser/src/index.ts"]
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPage, closeBrowser, generatePageMap } from "./browser.js";

const server = new McpServer({
  name: "mcp-textbrowser",
  version: "1.0.0",
});

// ── Helpers ──

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function pageContent(text: string, image?: string): { content: McpContent[] } {
  const content: McpContent[] = [{ type: "text", text }];
  if (image) content.push({ type: "image", data: image, mimeType: "image/png" });
  return { content };
}

// ── Tools ──

server.tool(
  "browser_navigate",
  "Open a URL in the browser and return the page context (DOM elements + OCR text). Default text-only mode — screenshot is captured only for OCR then discarded, zero image tokens. Set visual=true to also receive the PNG.",
  {
    url: z.string().describe("URL to open"),
    headless: z.boolean().optional().describe("Run headless (default true)"),
    visual: z.boolean().optional().describe("Return base64 PNG alongside text (default false = text-only, zero image tokens)"),
  },
  async ({ url, headless, visual }) => {
    const p = await getPage(headless ?? true);
    // domcontentloaded is more reliable than "load" for SPAs that never fire
    // the load event. Swallow navigation errors — the page content is usually
    // still readable even when Playwright considers navigation incomplete.
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(800);
    const { text, image } = await generatePageMap(p, visual);
    return pageContent(text, image);
  },
);

server.tool(
  "browser_click",
  "Click an element on the current page. Identify the target by CSS selector, XPath, or visible text. Returns updated page context after the click.",
  {
    selector: z.string().optional().describe("CSS selector"),
    xpath: z.string().optional().describe("XPath expression"),
    text: z.string().optional().describe("Visible text content to match (partial, case-insensitive)"),
    visual: z.boolean().optional().describe("Return base64 PNG alongside text (default false)"),
  },
  async ({ selector, xpath, text, visual }) => {
    const p = await getPage();
    if (selector) {
      await p.locator(selector).first().click({ timeout: 10000, force: true });
    } else if (xpath) {
      await p.locator(`xpath=${xpath}`).first().click({ timeout: 10000, force: true });
    } else if (text) {
      await p.getByText(text, { exact: false }).first().click({ timeout: 10000, force: true });
    } else {
      return { content: [{ type: "text" as const, text: "Error: provide selector, xpath, or text" }], isError: true };
    }
    await p.waitForTimeout(500);
    const { text: pageText, image } = await generatePageMap(p, visual);
    return pageContent(pageText, image);
  },
);

server.tool(
  "browser_type",
  "Type text into an input field on the current page. By default clears the field first. Returns updated page context.",
  {
    selector: z.string().describe("CSS selector for the input element"),
    text: z.string().describe("Text to type"),
    clear: z.boolean().optional().describe("Clear existing value before typing (default true)"),
    visual: z.boolean().optional().describe("Return base64 PNG alongside text (default false)"),
  },
  async ({ selector, text, clear, visual }) => {
    const p = await getPage();
    const locator = p.locator(selector).first();
    if (clear !== false) {
      await locator.fill(text);
    } else {
      await locator.pressSequentially(text);
    }
    const { text: pageText, image } = await generatePageMap(p, visual);
    return pageContent(pageText, image);
  },
);

server.tool(
  "browser_scroll",
  "Scroll the current page. Use direction (up/down/left/right) with an optional pixel amount, or provide a selector to scroll that element into view.",
  {
    direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction (default: down)"),
    amount: z.number().optional().describe("Pixels to scroll (default 800)"),
    selector: z.string().optional().describe("CSS selector — scroll this element into view instead"),
    visual: z.boolean().optional().describe("Return base64 PNG alongside text (default false)"),
  },
  async ({ direction, amount, selector, visual }) => {
    const p = await getPage();
    if (selector) {
      await p.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 10000 });
    } else {
      const dir = direction ?? "down";
      const amt = amount ?? 800;
      const delta = dir === "up" || dir === "left" ? -amt : amt;
      const isVertical = dir === "up" || dir === "down";
      // Inline values into string to avoid bundler __name injection
      await p.evaluate(`window.scrollBy(${isVertical ? 0 : delta}, ${isVertical ? delta : 0})`);
    }
    await p.waitForTimeout(300);
    const { text, image } = await generatePageMap(p, visual);
    return pageContent(text, image);
  },
);

server.tool(
  "browser_screenshot",
  "Capture the current page and return an OCR-based text map. The screenshot itself is discarded unless visual=true.",
  {
    visual: z.boolean().optional().describe("Return base64 PNG alongside text (default false)"),
  },
  async ({ visual }) => {
    const p = await getPage();
    const { text, image } = await generatePageMap(p, visual);
    return pageContent(text, image);
  },
);

server.tool(
  "browser_read",
  "Read the current page context (DOM elements + OCR text) without navigating or clicking anything.",
  {
    visual: z.boolean().optional().describe("Return base64 PNG alongside text (default false)"),
  },
  async ({ visual }) => {
    const p = await getPage();
    const { text, image } = await generatePageMap(p, visual);
    return pageContent(text, image);
  },
);

server.tool(
  "browser_evaluate",
  "Execute JavaScript in the current page context and return the result. Restricted to safe DOM read operations — eval, Function, fetch, WebSocket, and document.write are blocked.",
  {
    script: z.string().describe("JavaScript expression to evaluate (must not use eval, Function, import, fetch, WebSocket, or document.write)"),
  },
  async ({ script }) => {
    const banned = /\beval\b|\bFunction\b|\bimport\b|\bWebSocket\b|\bfetch\b\(|\bXMLHttpRequest\b|\bdocument\.write\b/i;
    if (banned.test(script)) {
      return {
        content: [{ type: "text" as const, text: "⚠️ Script rejected: contains banned keywords (eval, Function, import, WebSocket, fetch, XMLHttpRequest, document.write)." }],
        isError: true,
      };
    }
    const p = await getPage();
    const result = await p.evaluate((s: string) => {
      try {
        const fn = new Function(`"use strict"; return (${s})`);
        return fn();
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    }, script);
    const text = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
    return { content: [{ type: "text" as const, text }] };
  },
);

// ── Startup ──

process.on("SIGINT", async () => { await closeBrowser(); process.exit(0); });
process.on("SIGTERM", async () => { await closeBrowser(); process.exit(0); });

const transport = new StdioServerTransport();
await server.connect(transport);
