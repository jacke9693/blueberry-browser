import { generateObject, generateText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Tab } from "./Tab";

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

interface CaptchaSolution {
  success: boolean;
  answer?: string;
  error?: string;
}

export class CaptchaSolver {
  private model: LanguageModel | null;

  constructor(model: LanguageModel | null) {
    this.model = model;
  }

  /**
   * Detect CAPTCHA on the current page
   */
  async detectCaptcha(tab: Tab): Promise<CaptchaDetectionResult> {
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
   * Solve a visual CAPTCHA (like reCAPTCHA/hCaptcha) by analyzing the screenshot
   */
  private async solveVisualCaptcha(
    tab: Tab,
    instruction: string,
  ): Promise<CaptchaSolution> {
    if (!this.model) {
      return {
        success: false,
        error:
          "LLM model not initialized. Please configure your API key in .env file.",
      };
    }

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
        model: this.model,
        schema: z.object({
          prompt: z
            .string()
            .describe("The text of the CAPTCHA prompt/question"),
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
        const clicked = await this.clickCaptchaImages(
          tab,
          analysis.selectedImages,
        );
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
   * Click CAPTCHA images in the grid
   */
  private async clickCaptchaImages(
    tab: Tab,
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
   * Click the "I'm not a robot" checkbox
   */
  private async clickRobotCheckbox(tab: Tab): Promise<boolean> {
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
  private async isChallengePresent(tab: Tab): Promise<boolean> {
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
  async solveTextCaptcha(tab: Tab, question: string): Promise<CaptchaSolution> {
    if (!this.model) {
      return {
        success: false,
        error:
          "LLM model not initialized. Please configure your API key in .env file.",
      };
    }

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
        model: this.model,
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
  async solveImageCaptcha(
    tab: Tab,
    _imageUrl: string,
    question: string,
  ): Promise<CaptchaSolution> {
    if (!this.model) {
      return {
        success: false,
        error:
          "LLM model not initialized. Please configure your API key in .env file.",
      };
    }

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
        model: this.model,
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
  async fillCaptchaAnswer(
    tab: Tab,
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
  async autoSolveCaptcha(tab: Tab): Promise<{
    success: boolean;
    message: string;
    answer?: string;
  }> {
    // Step 1: Detect CAPTCHA
    const detection = await this.detectCaptcha(tab);

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
      await this.clickRobotCheckbox(tab);

      // Wait for potential challenge to appear
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Keep solving until no challenge is present (indefinite iterations)
      let iteration = 0;

      while (true) {
        const challengePresent = await this.isChallengePresent(tab);
        if (!challengePresent) {
          return {
            success: true,
            message: `reCAPTCHA solved successfully after ${iteration} ${iteration === 1 ? "iteration" : "iterations"}!`,
          };
        }

        iteration++;
        console.log(`Solving reCAPTCHA challenge iteration ${iteration}...`);

        // Take screenshot and analyze
        const solution = await this.solveVisualCaptcha(
          tab,
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
    let solution: CaptchaSolution;

    if (
      detection.type === "image" &&
      detection.imageUrl &&
      detection.question
    ) {
      solution = await this.solveImageCaptcha(
        tab,
        detection.imageUrl,
        detection.question,
      );
    } else if (detection.type === "text" && detection.question) {
      solution = await this.solveTextCaptcha(tab, detection.question);
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
      const filled = await this.fillCaptchaAnswer(
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
}
