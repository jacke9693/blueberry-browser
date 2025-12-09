import { tool } from "ai";
import { z } from "zod";
import type { ToolContext, ToolSet, ToolResult } from "./types";

/**
 * Helper to ensure an active tab exists before executing a tool
 */
function withActiveTab<T extends ToolResult>(
  context: ToolContext,
  fn: (tab: NonNullable<ReturnType<ToolContext["getActiveTab"]>>) => Promise<T>,
): Promise<T> {
  const tab = context.getActiveTab();
  if (!tab) {
    return Promise.resolve({
      success: false,
      error: "No active tab available",
    } as T);
  }
  return fn(tab);
}

/**
 * Helper to wrap tool execution with error handling
 */
async function withErrorHandling<T extends ToolResult>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    } as T;
  }
}

export function createBrowserAutomationTools(context: ToolContext): ToolSet {
  return {
    executeJavaScript: tool({
      description:
        "Execute JavaScript code on the current web page. The code runs in the context of the page and can interact with the DOM, read data, or perform actions. Returns the result of the last expression.",
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "The JavaScript code to execute on the page. Can be any valid JavaScript that would work in the browser console.",
          ),
      }),
      execute: async ({ code }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const result = await tab.runJs(code);
            return {
              success: true,
              result:
                result !== undefined
                  ? JSON.stringify(result, null, 2)
                  : "undefined",
            };
          }),
        ),
    }),

    navigateToUrl: tool({
      description:
        "Navigate the current tab to a specified URL. Use this to open websites or navigate to specific pages.",
      inputSchema: z.object({
        url: z
          .string()
          .describe(
            "The URL to navigate to (e.g., 'https://example.com' or 'https://google.com/search?q=test')",
          ),
      }),
      execute: async ({ url }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            let fullUrl = url;
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
              fullUrl = `https://${url}`;
            }
            await tab.loadURL(fullUrl);
            return {
              success: true,
              message: `Navigated to ${fullUrl}`,
            };
          }),
        ),
    }),

    clickElement: tool({
      description:
        "Click on an element on the current page using a CSS selector. Useful for interacting with buttons, links, and other clickable elements.",
      inputSchema: z.object({
        selector: z
          .string()
          .describe(
            "CSS selector for the element to click (e.g., 'button.submit', '#login-btn', 'a[href=\"/about\"]')",
          ),
      }),
      execute: async ({ selector }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const result = (await tab.runJs(`
              (function() {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) {
                  return { found: false, error: 'Element not found' };
                }
                element.click();
                return { found: true, tagName: element.tagName, text: element.textContent?.slice(0, 100) };
              })()
            `)) as { found: boolean; tagName?: string; text?: string };

            if (!result.found) {
              return {
                success: false,
                error: `Element not found: ${selector}`,
              };
            }
            return {
              success: true,
              message: `Clicked ${result.tagName} element`,
              elementText: result.text,
            };
          }),
        ),
    }),

    typeText: tool({
      description:
        "Type text into an input field or textarea on the current page. First focuses the element, then sets its value.",
      inputSchema: z.object({
        selector: z
          .string()
          .describe(
            "CSS selector for the input element (e.g., 'input[name=\"email\"]', '#search-box', 'textarea.comment')",
          ),
        text: z.string().describe("The text to type into the element"),
        pressEnter: z
          .boolean()
          .optional()
          .describe(
            "Whether to simulate pressing Enter after typing (default: false)",
          ),
      }),
      execute: async ({ selector, text, pressEnter }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const enterScript = pressEnter
              ? `
                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                if (element.form) element.form.submit();
              `
              : "";

            const result = (await tab.runJs(`
              (function() {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) {
                  return { found: false, error: 'Element not found' };
                }
                element.focus();
                element.value = ${JSON.stringify(text)};
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                ${enterScript}
                return { found: true, tagName: element.tagName };
              })()
            `)) as { found: boolean; tagName?: string };

            if (!result.found) {
              return {
                success: false,
                error: `Element not found: ${selector}`,
              };
            }
            return {
              success: true,
              message: `Typed text into ${result.tagName} element${pressEnter ? " and pressed Enter" : ""}`,
            };
          }),
        ),
    }),

    getPageInfo: tool({
      description:
        "Get information about the current page including URL, title, and optionally a list of interactive elements.",
      inputSchema: z.object({
        includeElements: z
          .boolean()
          .optional()
          .describe(
            "Whether to include a list of interactive elements (links, buttons, inputs) - default: false",
          ),
      }),
      execute: async ({ includeElements }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const baseInfo = {
              url: tab.url,
              title: tab.title,
            };

            if (!includeElements) {
              return {
                success: true,
                ...baseInfo,
              };
            }

            const elements = await tab.runJs(`
              (function() {
                const getElements = (selector, type) => 
                  Array.from(document.querySelectorAll(selector)).slice(0, 20).map(el => ({
                    type,
                    text: (el.textContent || el.value || '').slice(0, 50).trim(),
                    selector: el.id ? '#' + el.id : (el.className ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()),
                    href: el.href || undefined,
                    name: el.name || undefined,
                  }));
                
                return {
                  links: getElements('a[href]', 'link'),
                  buttons: getElements('button, input[type="submit"], input[type="button"]', 'button'),
                  inputs: getElements('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select', 'input'),
                };
              })()
            `);

            return {
              success: true,
              ...baseInfo,
              elements,
            };
          }),
        ),
    }),

    extractData: tool({
      description:
        "Extract structured data from the current page using CSS selectors. Useful for scraping content, reading tables, or gathering information.",
      inputSchema: z.object({
        selectors: z
          .record(z.string(), z.string())
          .describe(
            "An object mapping field names to CSS selectors. Example: { 'title': 'h1', 'price': '.price', 'description': 'p.desc' }",
          ),
        multiple: z
          .boolean()
          .optional()
          .describe(
            "If true, extract all matching elements for each selector as arrays. If false (default), only the first match.",
          ),
      }),
      execute: async ({ selectors, multiple }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const result = await tab.runJs(`
              (function() {
                const selectors = ${JSON.stringify(selectors)};
                const multiple = ${JSON.stringify(!!multiple)};
                const data = {};
                
                for (const [key, selector] of Object.entries(selectors)) {
                  if (multiple) {
                    data[key] = Array.from(document.querySelectorAll(selector))
                      .map(el => el.textContent?.trim() || el.value || '')
                      .filter(Boolean);
                  } else {
                    const el = document.querySelector(selector);
                    data[key] = el ? (el.textContent?.trim() || el.value || '') : null;
                  }
                }
                
                return data;
              })()
            `);
            return {
              success: true,
              data: result,
            };
          }),
        ),
    }),

    waitForElement: tool({
      description:
        "Wait for an element to appear on the page. Useful after navigation or when content loads dynamically.",
      inputSchema: z.object({
        selector: z
          .string()
          .describe("CSS selector for the element to wait for"),
        timeout: z
          .number()
          .optional()
          .describe("Maximum time to wait in milliseconds (default: 5000)"),
      }),
      execute: async ({ selector, timeout = 5000 }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const result = (await tab.runJs(`
              new Promise((resolve) => {
                const selector = ${JSON.stringify(selector)};
                const timeout = ${timeout};
                
                // Check if element already exists
                if (document.querySelector(selector)) {
                  resolve({ found: true, waited: 0 });
                  return;
                }
                
                const startTime = Date.now();
                const observer = new MutationObserver(() => {
                  if (document.querySelector(selector)) {
                    observer.disconnect();
                    resolve({ found: true, waited: Date.now() - startTime });
                  }
                });
                
                observer.observe(document.body, { childList: true, subtree: true });
                
                setTimeout(() => {
                  observer.disconnect();
                  resolve({ found: false, waited: timeout });
                }, timeout);
              })
            `)) as { found: boolean; waited: number };

            if (result.found) {
              return {
                success: true,
                message: `Element found after ${result.waited}ms`,
              };
            }
            return {
              success: false,
              error: `Element not found within ${timeout}ms: ${selector}`,
            };
          }),
        ),
    }),

    screenshot: tool({
      description:
        "Take a screenshot of the current page. The screenshot is automatically included in the conversation context.",
      inputSchema: z.object({}),
      execute: async () =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const image = await tab.screenshot();
            const dataUrl = image.toDataURL();
            return {
              success: true,
              message: "Screenshot captured successfully",
              imageDataUrl: dataUrl,
            };
          }),
        ),
    }),
  };
}
