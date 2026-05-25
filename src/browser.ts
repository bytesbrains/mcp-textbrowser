import type { Page, Browser, BrowserContext } from "playwright";

// ── Module-level browser state (one instance per MCP session) ──

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let ocrWorker: any = null;
let currentHeadless = true;

export async function getPage(headless?: boolean): Promise<Page> {
  headless = headless ?? currentHeadless;
  if (!page || headless !== currentHeadless) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    currentHeadless = headless;
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    page = await context.newPage();
  }
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (ocrWorker) {
    try { await ocrWorker.terminate(); } catch { /* ignore */ }
    ocrWorker = null;
  }
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
    context = null;
    page = null;
  }
}

// ── OCR helper ──

async function getOcrWorker(): Promise<any | null> {
  if (ocrWorker) return ocrWorker;
  try {
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("eng");
    return ocrWorker;
  } catch {
    return null;
  }
}

async function runOcr(buffer: Buffer): Promise<string> {
  const worker = await getOcrWorker();
  if (!worker) return "(OCR unavailable — install tesseract.js)";
  const { data: { text } } = await worker.recognize(buffer);
  return text.trim() || "(no text detected)";
}

// ── DOM traversal ──
// Passed as a string so bundlers (esbuild/tsup) never transform the function
// body — avoids the `__name is not defined` error that occurs when esbuild
// injects its helper into the module scope but Playwright can't find it in
// the browser context.

const DOM_TRAVERSAL_SCRIPT = `
  (() => {
    const interactive = new Set([
      "A","BUTTON","INPUT","TEXTAREA","SELECT","OPTION","LABEL","DETAILS","SUMMARY"
    ]);
    const keepAttrs = [
      "id","name","type","placeholder","href","src","alt","role","aria-label","value"
    ];
    const results = [];
    let index = 0;

    function processElement(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      if (rect.width < 2 || rect.height < 2) return;

      const isInteractive =
        interactive.has(el.tagName) ||
        el.onclick != null ||
        el.getAttribute("role") === "button" ||
        el.getAttribute("role") === "link";

      if (!isInteractive && rect.width * rect.height < 400) return;

      const text = (el.textContent || "").trim().slice(0, 200) || undefined;
      const attrs = {};
      for (const a of keepAttrs) {
        const v = el.getAttribute(a);
        if (v) attrs[a] = v;
      }

      results.push({
        index: ++index,
        tag: el.tagName.toLowerCase(),
        text,
        attributes: attrs,
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });

      if (el.shadowRoot) walkTree(el.shadowRoot);
    }

    function walkTree(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) processElement(walker.currentNode);
    }

    walkTree(document);
    return results;
  })()
`;

// ── Page map generator ──

interface ElementInfo {
  index: number;
  tag: string;
  text?: string;
  attributes: Record<string, string>;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Generate a structured text map of the page.
 *
 * text-only (default): screenshot captured for OCR → image discarded. Zero image tokens.
 * visual: screenshot captured for OCR AND returned as base64 PNG.
 */
export async function generatePageMap(p: Page, visual = false): Promise<{ text: string; image?: string }> {
  const url = p.url();
  const title = await p.title().catch(() => "(no title)");
  const viewport = p.viewportSize() ?? { width: 1280, height: 800 };

  // String-based evaluate — immune to bundler __name injection
  const elements = await p.evaluate(DOM_TRAVERSAL_SCRIPT) as ElementInfo[];

  let screenshotBuffer: Buffer | null = null;
  let ocrText: string;
  try {
    screenshotBuffer = Buffer.from(await p.screenshot({ type: "png", fullPage: false }));
    ocrText = await runOcr(screenshotBuffer);
  } catch {
    ocrText = "(screenshot/OCR failed)";
  }

  const lines: string[] = [];
  lines.push(`Page: ${url}`);
  lines.push(`Title: ${title}`);
  lines.push(`Viewport: ${viewport.width}x${viewport.height}`);
  lines.push("");

  const interactiveEls = (elements || []).filter(
    (e) =>
      ["a", "button", "input", "textarea", "select"].includes(e.tag) ||
      e.attributes.role === "button" ||
      e.attributes.role === "link"
  );

  lines.push(`Elements (${interactiveEls.length} interactive of ${(elements || []).length} total):`);
  for (const el of interactiveEls.slice(0, 60)) {
    const attrStr = Object.entries(el.attributes)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    const bboxStr = el.bbox
      ? `bbox=(${el.bbox.x},${el.bbox.y},${el.bbox.x + el.bbox.width},${el.bbox.y + el.bbox.height})`
      : "";
    lines.push(`  [${el.index}] <${el.tag}> ${attrStr}${attrStr ? " " : ""}${bboxStr}`);
    if (el.text && el.text.length > 1) {
      lines.push(`      text: "${el.text.replace(/\n/g, " ")}"`);
    }
  }
  if (interactiveEls.length > 60) {
    lines.push(`  ... (${interactiveEls.length - 60} more interactive elements hidden)`);
  }

  lines.push("");
  lines.push("OCR (full page screenshot):");
  lines.push(ocrText || "(no text detected)");

  const text = lines.join("\n");

  if (!visual) return { text };
  return { text, image: screenshotBuffer?.toString("base64") };
}
