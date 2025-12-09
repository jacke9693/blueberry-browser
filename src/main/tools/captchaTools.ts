import { tool } from "ai";
import { z } from "zod";
import type { ToolContext, ToolSet, ToolResult } from "./types";
import { CaptchaSolver } from "../CaptchaSolver";

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

export function createCaptchaTools(
  context: ToolContext,
  solver: CaptchaSolver,
): ToolSet {
  return {
    detectCaptcha: tool({
      description:
        "Detect if there is a CAPTCHA on the current page. Use this to check for CAPTCHAs before attempting to solve them. Returns the type of CAPTCHA found (recaptcha, hcaptcha, text, image) and relevant information like selectors and questions.",
      inputSchema: z.object({}),
      execute: async () =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const detection = await solver.detectCaptcha(tab);

            if (!detection.found) {
              return {
                success: true,
                found: false,
                message: "No CAPTCHA detected on this page",
              };
            }

            return {
              success: true,
              found: true,
              type: detection.type,
              message: `Found ${detection.type} CAPTCHA`,
              selector: detection.selector,
              question: detection.question,
              imageUrl: detection.imageUrl,
            };
          }),
        ),
    }),

    solveCaptcha: tool({
      description:
        "Automatically detect and solve any CAPTCHA on the current page. This handles reCAPTCHA, hCaptcha, text-based CAPTCHAs, and image CAPTCHAs. The solver uses AI vision to analyze and solve the challenge. For reCAPTCHA/hCaptcha, it will click the checkbox, analyze image grids, and iterate until the challenge is solved. For text/image CAPTCHAs, it will read the challenge and fill in the answer.",
      inputSchema: z.object({
        forceRetry: z
          .boolean()
          .optional()
          .describe(
            "If true, attempts to solve even if no CAPTCHA is initially detected (useful if CAPTCHA appears after interaction)",
          ),
      }),
      execute: async ({ forceRetry = false }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            // First detect
            if (!forceRetry) {
              const detection = await solver.detectCaptcha(tab);
              if (!detection.found) {
                return {
                  success: false,
                  error:
                    "No CAPTCHA detected. Use detectCaptcha first to verify.",
                };
              }
            }

            // Solve
            const result = await solver.autoSolveCaptcha(tab);

            return {
              success: result.success,
              message: result.message,
              answer: result.answer,
              error: result.success ? undefined : result.message,
            };
          }),
        ),
    }),

    solveTextCaptcha: tool({
      description:
        "Solve a text-based CAPTCHA by providing the question text. The AI will analyze the page screenshot and attempt to read/solve the CAPTCHA (e.g., math problems, distorted text). Use this when you've detected a text CAPTCHA and want to solve it directly.",
      inputSchema: z.object({
        question: z
          .string()
          .describe(
            "The CAPTCHA question or prompt text (e.g., 'What is 5 + 3?' or 'Enter the text shown in the image')",
          ),
        selector: z
          .string()
          .optional()
          .describe(
            "CSS selector for the input field to fill with the answer. If not provided, will return the answer without filling.",
          ),
      }),
      execute: async ({ question, selector }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const solution = await solver.solveTextCaptcha(tab, question);

            if (!solution.success) {
              return {
                success: false,
                error: solution.error || "Failed to solve CAPTCHA",
              };
            }

            // If selector provided, try to fill the answer
            if (selector && solution.answer) {
              const filled = await solver.fillCaptchaAnswer(
                tab,
                selector,
                solution.answer,
              );

              if (filled) {
                return {
                  success: true,
                  message: `Solved and filled CAPTCHA with answer: ${solution.answer}`,
                  answer: solution.answer,
                };
              } else {
                return {
                  success: true,
                  message: `Solved CAPTCHA but couldn't auto-fill. Answer: ${solution.answer}`,
                  answer: solution.answer,
                  warning: "Could not find or fill the input field",
                };
              }
            }

            return {
              success: true,
              message: `CAPTCHA solved: ${solution.answer}`,
              answer: solution.answer,
            };
          }),
        ),
    }),

    solveImageCaptcha: tool({
      description:
        "Solve an image-based CAPTCHA where text or patterns are shown in an image. The AI will analyze the screenshot and attempt to read the distorted text or identify the pattern. Use this for CAPTCHAs that display text in an image format.",
      inputSchema: z.object({
        question: z
          .string()
          .describe(
            "The CAPTCHA question or instruction (e.g., 'Enter the characters shown in the image')",
          ),
        imageSelector: z
          .string()
          .optional()
          .describe(
            "CSS selector for the CAPTCHA image (e.g., 'img[alt*=\"captcha\"]')",
          ),
        answerSelector: z
          .string()
          .optional()
          .describe("CSS selector for the input field to fill with the answer"),
      }),
      execute: async ({ question, imageSelector, answerSelector }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            // Get image URL if selector provided
            let imageUrl = "";
            if (imageSelector) {
              const script = `
                (function() {
                  const img = document.querySelector('${imageSelector}');
                  return img ? img.src : '';
                })()
              `;
              imageUrl = (await tab.runJs(script)) as string;
            }

            const solution = await solver.solveImageCaptcha(
              tab,
              imageUrl,
              question,
            );

            if (!solution.success) {
              return {
                success: false,
                error: solution.error || "Failed to solve image CAPTCHA",
              };
            }

            // If answer selector provided, try to fill the answer
            if (answerSelector && solution.answer) {
              const filled = await solver.fillCaptchaAnswer(
                tab,
                answerSelector,
                solution.answer,
              );

              if (filled) {
                return {
                  success: true,
                  message: `Solved and filled image CAPTCHA with answer: ${solution.answer}`,
                  answer: solution.answer,
                };
              } else {
                return {
                  success: true,
                  message: `Solved image CAPTCHA but couldn't auto-fill. Answer: ${solution.answer}`,
                  answer: solution.answer,
                  warning: "Could not find or fill the input field",
                };
              }
            }

            return {
              success: true,
              message: `Image CAPTCHA solved: ${solution.answer}`,
              answer: solution.answer,
            };
          }),
        ),
    }),

    fillCaptchaAnswer: tool({
      description:
        "Fill a CAPTCHA answer into an input field on the page. Use this when you have the answer to a CAPTCHA and need to enter it into the form. The tool will locate the input field and fill it with the provided answer.",
      inputSchema: z.object({
        selector: z
          .string()
          .describe(
            "CSS selector for the CAPTCHA input field (e.g., 'input[name=\"captcha\"]', '#captcha-input')",
          ),
        answer: z
          .string()
          .describe("The answer to fill into the CAPTCHA field"),
      }),
      execute: async ({ selector, answer }) =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const filled = await solver.fillCaptchaAnswer(
              tab,
              selector,
              answer,
            );

            if (filled) {
              return {
                success: true,
                message: `Successfully filled CAPTCHA answer: ${answer}`,
              };
            }

            return {
              success: false,
              error: `Could not find or fill input field with selector: ${selector}`,
            };
          }),
        ),
    }),
  };
}
