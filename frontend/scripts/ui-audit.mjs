import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [url, output, widthText = "500", heightText = "844", selector = ""] = process.argv.slice(2);
if (!url || !output) {
  console.error("Usage: node scripts/ui-audit.mjs <url> <png> [width] [height] [click-selector]");
  process.exit(2);
}

const width = Number(widthText);
const height = Number(heightText);
const candidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

let executable = "";
for (const candidate of candidates) {
  try {
    await access(candidate);
    executable = candidate;
    break;
  } catch {
    // Try the next installed browser.
  }
}
if (!executable) throw new Error("Chrome or Edge was not found");

const profile = await mkdtemp(path.join(os.tmpdir(), "city-ui-audit-"));
const port = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(executable, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { windowsHide: true, stdio: "ignore" });

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let page;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    page = pages.find(item => item.type === "page");
    if (page) break;
  } catch {
    // Browser is still starting.
  }
  await sleep(100);
}
if (!page) throw new Error("Chrome DevTools endpoint did not start");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let callId = 0;
const pending = new Map();
const exceptions = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails);
    return;
  }
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++callId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    // Телефон и в альбомной ориентации: без мобильной эмуляции браузер не применяет meta viewport.
    mobile: width < 700 || height <= 640,
    screenWidth: width,
    screenHeight: height,
  });
  await call("Page.navigate", { url });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await call("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    if (state.result.value === "complete") break;
    await sleep(100);
  }
  await sleep(700);

  // A freshly restarted Vite server can finish `load` before React has committed the board.
  // Wait for the instrumented UI so a transient empty frame is reported as a failure instead
  // of being mistaken for a successful audit of zero elements.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await call("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('[data-ui]'))",
      returnByValue: true,
    });
    if (ready.result.value) break;
    await sleep(100);
  }

  if (selector) {
    for (const rawStep of selector.split(">>>").map(item => item.trim()).filter(Boolean)) {
      const [step, indexText = "0"] = rawStep.split("@@");
      const index = Number(indexText);
      const clicked = await call("Runtime.evaluate", {
        expression: `(() => { const node = document.querySelectorAll(${JSON.stringify(step)})[${index}]; if (!node) return false; node.click(); return true; })()`,
        returnByValue: true,
      });
      if (!clicked.result.value) throw new Error(`Selector not found: ${rawStep}`);
      await sleep(350);
    }
  }

  const audit = await call("Runtime.evaluate", {
    expression: `(() => {
      const epsilon = 1.25;
      const visible = node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      return [...document.querySelectorAll("[data-ui]")].filter(visible).map((node, index) => {
        const rect = node.getBoundingClientRect();
        const parentRect = node.parentElement?.getBoundingClientRect();
        const children = [...node.children].filter(child => {
          if (!visible(child)) return false;
          const position = getComputedStyle(child).position;
          return position !== "absolute" && position !== "fixed";
        });
        const overlaps = [];
        for (let left = 0; left < children.length; left += 1) {
          const a = children[left].getBoundingClientRect();
          for (let right = left + 1; right < children.length; right += 1) {
            const b = children[right].getBoundingClientRect();
            const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (x > epsilon && y > epsilon) overlaps.push([left, right]);
          }
        }
        return {
          index,
          type: node.dataset.ui,
          bounds: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)],
          position: getComputedStyle(node).position,
          transform: getComputedStyle(node).transform,
          inlineStyle: node.getAttribute("style"),
          parent: parentRect ? {
            bounds: [Math.round(parentRect.left), Math.round(parentRect.top), Math.round(parentRect.right), Math.round(parentRect.bottom)],
            position: getComputedStyle(node.parentElement).position,
            transform: getComputedStyle(node.parentElement).transform,
            inlineStyle: node.parentElement.getAttribute("style"),
          } : null,
          size: [Math.round(rect.width), Math.round(rect.height)],
          scroll: [node.scrollWidth, node.scrollHeight],
          overflowX: node.scrollWidth > node.clientWidth + 1,
          overflowY: node.scrollHeight > node.clientHeight + 1,
          offscreen: rect.left < -epsilon || rect.top < -epsilon || rect.right > innerWidth + epsilon || rect.bottom > innerHeight + epsilon,
          overlaps,
          text: node.textContent.trim().replace(/\\s+/g, " ").slice(0, 100),
        };
      });
    })()`,
    returnByValue: true,
  });
  const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(output, Buffer.from(shot.data, "base64"));
  const report = {
    url,
    viewport: { width, height },
    selector: selector || null,
    exceptions: exceptions.map(item => ({
      text: item.text,
      description: item.exception?.description,
      url: item.url,
      line: item.lineNumber,
      column: item.columnNumber,
    })),
    viewportReported: await call("Runtime.evaluate", {
      expression: "({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})",
      returnByValue: true,
    }).then(result => result.result.value),
    elements: audit.result.value,
  };
  await writeFile(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const failures = report.elements.filter(item => item.overflowX || item.overflowY || item.offscreen || item.overlaps.length);
  console.log(JSON.stringify({ output, checked: report.elements.length, failures, exceptions: report.exceptions }, null, 2));
} finally {
  try { socket.send(JSON.stringify({ id: ++callId, method: "Browser.close", params: {} })); } catch {}
  await sleep(500);
  socket.close();
  browser.kill();
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
  } catch (error) {
    // Windows can keep Chrome's lockfile for a moment after the process exits. The profile is
    // temporary, so a cleanup miss must not turn a successful visual audit into a failed build.
    console.warn(`Temporary profile cleanup deferred: ${error.message}`);
  }
}
