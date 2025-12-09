import { tool, generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import type { ToolContext, ToolSet, ToolResult } from "./types";

// Simplified Tab interface for CAPTCHA operations
interface TabLike {
  runJs: (code: string) => Promise<unknown>;
  screenshot: () => Promise<{ toDataURL: () => string }>;
}

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

// ============================================================================
// CAPTCHA Detection and Solving Logic
// ============================================================================

interface CaptchaDetectionResult {
  found: boolean;
  type: "text" | "image" | "recaptcha" | "hcaptcha" | "unknown";
  selector?: string;
  imageUrl?: string;
  question?: string;
}

interface RecaptchaAnalysis {
  prompt: string;
  gridSize: number;
  selectedImages: number[];
}

/**
 * Detect CAPTCHA on the current page
 */
async function detectCaptcha(tab: TabLike): Promise<CaptchaDetectionResult> {
  const detectionScript = `
    (function() {
      // Check for common CAPTCHA elements
      const captchaIndicators = {
        recaptcha: document.querySelector('.g-recaptcha, #recaptcha, iframe[src*="recaptcha"]'),
        recaptchaCheckbox: document.querySelector('.recaptcha-checkbox, iframe[title*="recaptcha"]'),
        hcaptcha: document.querySelector('.h-captcha, #hcaptcha, iframe[src*="hcaptcha"]'),
        textCaptcha: document.querySelector('input[name*="captcha" i], input[id*="captcha" i]'),
        imageCaptcha: document.querySelector('img[alt*="captcha" i], img[src*="captcha" i]')
      };

      // Find which type exists
      if (captchaIndicators.recaptcha || captchaIndicators.recaptchaCheckbox) {
        return { found: true, type: 'recaptcha', selector: '.g-recaptcha' };
      }
      if (captchaIndicators.hcaptcha) {
        return { found: true, type: 'hcaptcha', selector: '.h-captcha' };
      }
      if (captchaIndicators.imageCaptcha) {
        const img = captchaIndicators.imageCaptcha;
        const question = img.parentElement?.textContent?.trim() || 
                        document.querySelector('label[for*="captcha" i]')?.textContent?.trim() ||
                        'What is shown in this image?';
        return { 
          found: true, 
          type: 'image', 
          selector: 'img[alt*="captcha" i], img[src*="captcha" i]',
          imageUrl: img.src,
          question: question
        };
      }
      if (captchaIndicators.textCaptcha) {
        const question = document.querySelector('label[for*="captcha" i]')?.textContent?.trim() ||
                        captchaIndicators.textCaptcha.parentElement?.textContent?.trim() ||
                        'Solve the CAPTCHA';
        return { 
          found: true, 
          type: 'text', 
          selector: 'input[name*="captcha" i], input[id*="captcha" i]',
          question: question
        };
      }

      return { found: false, type: 'unknown' };
    })()
  `;

  try {
    const result = await tab.runJs(detectionScript);
    return result as CaptchaDetectionResult;
  } catch (error) {
    console.error("Error detecting CAPTCHA:", error);
    return { found: false, type: "unknown" };
  }
}

/**
 * Click CAPTCHA images in the grid
 */
async function clickCaptchaImages(
  tab: TabLike,
  imageIndices: number[],
): Promise<boolean> {
  const clickScript = `
    (function() {
      return new Promise((resolve) => {
        try {
          // Find the reCAPTCHA/hCaptcha iframe
          const frames = document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
          if (frames.length === 0) {
            resolve(false);
            return;
          }
          
          // Look for the challenge iframe (usually the larger one)
          let challengeFrame = null;
          for (const frame of frames) {
            const rect = frame.getBoundingClientRect();
            if (rect.width > 300 && rect.height > 300) {
              challengeFrame = frame;
              break;
            }
          }
          
          if (!challengeFrame) {
            // Try to find by title or name
            challengeFrame = Array.from(frames).find(f => 
              f.title?.includes('challenge') || f.name?.includes('challenge') || f.title?.includes('Challenge')
            );
          }
          
          if (!challengeFrame) {
            resolve(false);
            return;
          }
          
          // Get the frame's content document
          const frameDoc = challengeFrame.contentDocument || challengeFrame.contentWindow.document;
          
          // Find all image cells in the grid
          const cells = frameDoc.querySelectorAll('td.rc-imageselect-tile, .task-image, .challenge-container .image');
          if (cells.length === 0) {
            resolve(false);
            return;
          }
          
          // Click the specified indices with random delays
          const indices = ${JSON.stringify(imageIndices)};
          let clickIndex = 0;
          
          const clickNext = () => {
            if (clickIndex >= indices.length) {
              // Wait a bit, then click the verify button
              const finalDelay = Math.random() * 500 + 500; // 500-1000ms
              setTimeout(() => {
                const verifyBtn = frameDoc.querySelector('#recaptcha-verify-button, .button-submit, [type="submit"]');
                if (verifyBtn) verifyBtn.click();
                resolve(true);
              }, finalDelay);
              return;
            }
            
            const index = indices[clickIndex];
            const cellIndex = index - 1; // Convert to 0-based
            
            if (cellIndex >= 0 && cellIndex < cells.length) {
              cells[cellIndex].click();
            }
            
            clickIndex++;
            
            // Random delay between 300-800ms before next click
            const delay = Math.random() * 500 + 300;
            setTimeout(clickNext, delay);
          };
          
          // Start clicking with initial delay
          const initialDelay = Math.random() * 300 + 200; // 200-500ms
          setTimeout(clickNext, initialDelay);
          
        } catch (error) {
          console.error('Error clicking CAPTCHA:', error);
          resolve(false);
        }
      });
    })()
  `;

  try {
    const result = await tab.runJs(clickScript);
    return result as boolean;
  } catch (error) {
    console.error("Error executing click script:", error);
    return false;
  }
}

/**
 * Solve a visual CAPTCHA (like reCAPTCHA/hCaptcha) by analyzing the screenshot
 */
async function solveVisualCaptcha(
  tab: TabLike,
  model: LanguageModel,
  instruction: string,
): Promise<{ success: boolean; answer?: string; error?: string }> {
  try {
    const screenshot = await tab.screenshot();
    const screenshotDataUrl = screenshot.toDataURL();

    const prompt = `${instruction}

Analyze this reCAPTCHA/hCAPTCHA challenge and identify which images match the prompt.

Rules:
- Count images from 1-9, starting top-left, going left-to-right, top-to-bottom
- Only include image numbers that match the prompt criteria
- Be accurate and conservative - only select images that clearly match`;

    // Use generateObject for structured output
    const result = await generateObject({
      model,
      schema: z.object({
        prompt: z.string().describe("The text of the CAPTCHA prompt/question"),
        gridSize: z
          .number()
          .describe("Number of images in the grid (usually 9)"),
        selectedImages: z
          .array(z.number())
          .describe("Array of image numbers (1-9) that match the prompt"),
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: screenshotDataUrl,
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    const analysis = result.object as RecaptchaAnalysis;
    console.log("CAPTCHA Analysis:", analysis);

    // Click the selected images
    if (analysis.selectedImages && analysis.selectedImages.length > 0) {
      const clicked = await clickCaptchaImages(tab, analysis.selectedImages);
      if (clicked) {
        return {
          success: true,
          answer: `Selected images: ${analysis.selectedImages.join(", ")}. Prompt: ${analysis.prompt}`,
        };
      } else {
        return {
          success: false,
          error: `Identified images ${analysis.selectedImages.join(", ")} but could not click them automatically. Prompt: ${analysis.prompt}`,
        };
      }
    }

    return {
      success: false,
      error: "No images identified for selection",
    };
  } catch (error) {
    console.error("Error solving visual CAPTCHA:", error);
    return {
      success: false,
      error: `Failed to analyze CAPTCHA: ${error}`,
    };
  }
}

/**
 * Click the "I'm not a robot" checkbox
 */
async function clickRobotCheckbox(tab: TabLike): Promise<boolean> {
  const clickScript = `
    (function() {
      try {
        // Find the reCAPTCHA checkbox iframe
        const frames = document.querySelectorAll('iframe[src*="recaptcha"], iframe[title*="recaptcha"]');
        
        for (const frame of frames) {
          try {
            const rect = frame.getBoundingClientRect();
            // The checkbox iframe is usually small (around 300x70)
            if (rect.width < 400 && rect.height < 100) {
              const frameDoc = frame.contentDocument || frame.contentWindow.document;
              const checkbox = frameDoc.querySelector('.recaptcha-checkbox-border, #recaptcha-anchor');
              if (checkbox) {
                checkbox.click();
                return true;
              }
            }
          } catch (e) {
            // Cross-origin iframe, try clicking the iframe itself
            frame.click();
            return true;
          }
        }
        
        return false;
      } catch (error) {
        console.error('Error clicking checkbox:', error);
        return false;
      }
    })()
  `;

  try {
    const result = await tab.runJs(clickScript);
    return result as boolean;
  } catch (error) {
    console.error("Error executing checkbox click script:", error);
    return false;
  }
}

/**
 * Check if challenge is still present
 */
async function isChallengePresent(tab: TabLike): Promise<boolean> {
  const checkScript = `
    (function() {
      const frames = document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
      for (const frame of frames) {
        const rect = frame.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 300) {
          return true; // Challenge frame is present
        }
      }
      return false;
    })()
  `;

  try {
    const result = await tab.runJs(checkScript);
    return result as boolean;
  } catch {
    return false;
  }
}

/**
 * Solve a text-based CAPTCHA using the LLM with page screenshot
 */
async function solveTextCaptcha(
  tab: TabLike,
  model: LanguageModel,
  question: string,
): Promise<{ success: boolean; answer?: string; error?: string }> {
  try {
    const screenshot = await tab.screenshot();
    const screenshotDataUrl = screenshot.toDataURL();

    const prompt = `You are a CAPTCHA solver. Look at the screenshot and answer the CAPTCHA question.

Question: ${question}

Instructions:
- Look carefully at the CAPTCHA image in the screenshot
- Provide ONLY the answer, nothing else
- For math problems, provide just the number
- For text recognition, provide the exact text you see
- Be concise and accurate

Answer:`;

    // Use generateText for simple text response
    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: screenshotDataUrl,
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    // Clean up the answer
    let answer = result.text.trim().split("\n")[0]; // Take only first line
    answer = answer.replace(/[^a-zA-Z0-9\s]/g, ""); // Remove special chars

    return {
      success: true,
      answer,
    };
  } catch (error) {
    console.error("Error solving CAPTCHA:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Solve an image-based CAPTCHA
 */
async function solveImageCaptcha(
  tab: TabLike,
  model: LanguageModel,
  question: string,
): Promise<{ success: boolean; answer?: string; error?: string }> {
  try {
    const screenshot = await tab.screenshot();
    const screenshotDataUrl = screenshot.toDataURL();

    const prompt = `You are a CAPTCHA solver. Look at the CAPTCHA image and answer the question.

Question: ${question}

The CAPTCHA image is visible in the screenshot. Please analyze it carefully.

Instructions:
- Identify the text, numbers, or pattern in the CAPTCHA
- Provide ONLY the answer, nothing else
- For distorted text, try your best to read it
- Be accurate and concise

Answer:`;

    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: screenshotDataUrl,
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    // Clean up the answer
    let answer = result.text.trim().split("\n")[0];
    answer = answer.replace(/[^a-zA-Z0-9\s]/g, "");

    return {
      success: true,
      answer,
    };
  } catch (error) {
    console.error("Error solving CAPTCHA:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fill in the CAPTCHA answer on the page
 */
async function fillCaptchaAnswer(
  tab: TabLike,
  selector: string,
  answer: string,
): Promise<boolean> {
  const fillScript = `
    (function() {
      const element = document.querySelector('${selector}');
      if (!element) return false;
      
      if (element.tagName === 'INPUT') {
        element.value = '${answer.replace(/'/g, "\\'")}';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      
      return false;
    })()
  `;

  try {
    const result = await tab.runJs(fillScript);
    return result as boolean;
  } catch (error) {
    console.error("Error filling CAPTCHA:", error);
    return false;
  }
}

/**
 * Main method to detect and solve CAPTCHA automatically
 */
async function autoSolveCaptcha(
  tab: TabLike,
  model: LanguageModel,
): Promise<{
  success: boolean;
  message: string;
  answer?: string;
}> {
  // Step 1: Detect CAPTCHA
  const detection = await detectCaptcha(tab);

  if (!detection.found) {
    return {
      success: false,
      message: "No CAPTCHA detected on this page",
    };
  }

  // Step 2: Handle different CAPTCHA types
  if (detection.type === "recaptcha" || detection.type === "hcaptcha") {
    // First, try clicking the "I'm not a robot" checkbox
    console.log("Clicking 'I'm not a robot' checkbox...");
    await clickRobotCheckbox(tab);

    // Wait for potential challenge to appear
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Keep solving until no challenge is present (indefinite iterations)
    let iteration = 0;

    while (true) {
      const challengePresent = await isChallengePresent(tab);
      if (!challengePresent) {
        return {
          success: true,
          message: `reCAPTCHA solved successfully after ${iteration} ${iteration === 1 ? "iteration" : "iterations"}!`,
        };
      }

      iteration++;
      console.log(`Solving reCAPTCHA challenge iteration ${iteration}...`);

      // Take screenshot and analyze
      const solution = await solveVisualCaptcha(
        tab,
        model,
        `This is a ${detection.type} challenge. Analyze the image grid and the prompt to determine which images should be selected.`,
      );

      if (!solution.success) {
        return {
          success: false,
          message:
            solution.error ||
            `Failed to solve ${detection.type} after ${iteration} ${iteration === 1 ? "attempt" : "attempts"}`,
          answer: solution.answer,
        };
      }

      // Wait for the next challenge or success (random delay to appear more human)
      const waitTime = Math.random() * 2000 + 2000; // 2-4 seconds
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Safety check: if we've done more than 20 iterations, something might be wrong
      if (iteration > 20) {
        return {
          success: false,
          message: `Attempted ${iteration} iterations but CAPTCHA still present. There may be an issue with the solver.`,
        };
      }
    }
  }

  // Step 3: Solve the CAPTCHA
  let solution: { success: boolean; answer?: string; error?: string };

  if (detection.type === "image" && detection.imageUrl && detection.question) {
    solution = await solveImageCaptcha(tab, model, detection.question);
  } else if (detection.type === "text" && detection.question) {
    solution = await solveTextCaptcha(tab, model, detection.question);
  } else {
    return {
      success: false,
      message: "Unknown CAPTCHA type",
    };
  }

  if (!solution.success || !solution.answer) {
    return {
      success: false,
      message: solution.error || "Failed to solve CAPTCHA",
    };
  }

  // Step 4: Fill in the answer
  if (detection.selector) {
    const filled = await fillCaptchaAnswer(
      tab,
      detection.selector,
      solution.answer,
    );

    if (filled) {
      return {
        success: true,
        message: `CAPTCHA solved: ${solution.answer}`,
        answer: solution.answer,
      };
    } else {
      return {
        success: false,
        message: `Solved as "${solution.answer}" but couldn't fill automatically`,
        answer: solution.answer,
      };
    }
  }

  return {
    success: true,
    message: `CAPTCHA solved: ${solution.answer}`,
    answer: solution.answer,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function createCaptchaTools(
  context: ToolContext,
  model: LanguageModel,
): ToolSet {
  return {
    detectCaptcha: tool({
      description:
        "Detect if there is a CAPTCHA on the current page. Use this to check for CAPTCHAs before attempting to solve them. Returns the type of CAPTCHA found (recaptcha, hcaptcha, text, image) and relevant information like selectors and questions.",
      inputSchema: z.object({}),
      execute: async () =>
        withActiveTab(context, (tab) =>
          withErrorHandling(async () => {
            const detection = await detectCaptcha(tab);

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
              const detection = await detectCaptcha(tab);
              if (!detection.found) {
                return {
                  success: false,
                  error:
                    "No CAPTCHA detected. Use detectCaptcha first to verify.",
                };
              }
            }

            // Solve
            const result = await autoSolveCaptcha(tab, model);

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
            const solution = await solveTextCaptcha(tab, model, question);

            if (!solution.success) {
              return {
                success: false,
                error: solution.error || "Failed to solve CAPTCHA",
              };
            }

            // If selector provided, try to fill the answer
            if (selector && solution.answer) {
              const filled = await fillCaptchaAnswer(
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
            // Get image URL if selector provided (optional)
            if (imageSelector) {
              const script = `
                (function() {
                  const img = document.querySelector('${imageSelector}');
                  return img ? img.src : '';
                })()
              `;
              await tab.runJs(script); // Just for validation
            }

            const solution = await solveImageCaptcha(tab, model, question);

            if (!solution.success) {
              return {
                success: false,
                error: solution.error || "Failed to solve image CAPTCHA",
              };
            }

            // If answer selector provided, try to fill the answer
            if (answerSelector && solution.answer) {
              const filled = await fillCaptchaAnswer(
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
            const filled = await fillCaptchaAnswer(tab, selector, answer);

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
