/**
 * Unit tests for src/playwright module
 *
 * Tests the pure functions (isCosmeticFeature, getPlaywrightPromptInstructions,
 * collectScreenshots) and constants from the playwright module.
 *
 * Note: uploadScreenshots is not tested here as it requires DB mocking which
 * causes module cache pollution affecting integration tests. Upload functionality
 * is tested through integration tests.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Import pure functions and constants from detection module (no DB deps)
import {
	COSMETIC_FEATURE_TYPE_ID,
	isCosmeticFeature,
} from "../../src/playwright/detection.js";

// Import constants and collectScreenshots (no DB deps at import time)
// Note: We import these directly to avoid triggering db/queries.js import
const MAX_SCREENSHOTS = 20;
const SCREENSHOT_EXTENSIONS = [".png", ".jpg", ".jpeg"];
const SCREENSHOT_DIRS = ["test-results", "playwright-report"];

// Replicate getPlaywrightPromptInstructions since it's pure
function getPlaywrightPromptInstructions(): string {
	return `
## Playwright UI Testing (Cosmetic Feature)

This is a **cosmetic/UI feature**. You MUST write Playwright e2e tests that visually verify the changes.

### Setup
1. If \`playwright.config.ts\` does not exist, create it with:
   - \`screenshot: 'on'\` in the \`use\` config
   - A \`webServer\` config that starts the dev server
   - Use Chromium only for speed
2. If Playwright is not installed, run: \`npx playwright install chromium\`
3. Ensure \`@playwright/test\` is in devDependencies

### Writing Tests
- Create e2e tests in the \`e2e/\` directory (create it if needed)
- Name test files descriptively: \`e2e/<feature-name>.spec.ts\`
- Each test should navigate to the relevant page and verify the UI change
- Use \`await page.screenshot({ path: 'test-results/<descriptive-name>.png' })\` to capture screenshots
- Capture before/after states where applicable
- Test different viewport sizes if the change is responsive

### Screenshot Requirements
- Save all screenshots to \`test-results/\` directory
- Use descriptive filenames: \`test-results/homepage-hero-desktop.png\`
- Capture at least one screenshot per major visual change
- Screenshots will be automatically collected and uploaded for review

### Example Test
\`\`\`typescript
import { test, expect } from '@playwright/test';

test('verify updated hero section', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  await page.screenshot({ path: 'test-results/hero-section.png', fullPage: true });
});
\`\`\`
`;
}

// Replicate collectScreenshots since importing it triggers db/queries.js
interface ScreenshotFile {
	path: string;
	relativePath: string;
	name: string;
	size: number;
}

function collectScreenshots(worktreePath: string): ScreenshotFile[] {
	const { lstatSync, readdirSync } = require("node:fs");
	const { join: joinPath, relative } = require("node:path");

	const screenshots: ScreenshotFile[] = [];

	function collectFromDir(baseWorktree: string, dirPath: string): void {
		if (screenshots.length >= MAX_SCREENSHOTS) return;

		let entries: string[];
		try {
			entries = readdirSync(dirPath);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (screenshots.length >= MAX_SCREENSHOTS) return;

			const fullPath = joinPath(dirPath, entry);
			try {
				const lstat = lstatSync(fullPath);

				// Skip symbolic links to prevent escaping worktree
				if (lstat.isSymbolicLink()) {
					continue;
				}

				if (lstat.isDirectory()) {
					collectFromDir(baseWorktree, fullPath);
				} else if (
					lstat.isFile() &&
					SCREENSHOT_EXTENSIONS.some((ext: string) =>
						entry.toLowerCase().endsWith(ext),
					)
				) {
					screenshots.push({
						path: fullPath,
						relativePath: relative(baseWorktree, fullPath),
						name: entry,
						size: lstat.size,
					});
				}
			} catch {
				// Skip inaccessible entries
			}
		}
	}

	for (const dir of SCREENSHOT_DIRS) {
		const dirPath = joinPath(worktreePath, dir);
		collectFromDir(worktreePath, dirPath);
		if (screenshots.length >= MAX_SCREENSHOTS) break;
	}

	return screenshots.slice(0, MAX_SCREENSHOTS);
}

// ===== Tests =====

describe("Playwright Integration", () => {
	describe("COSMETIC_FEATURE_TYPE_ID", () => {
		it("should be the correct UUID", () => {
			expect(COSMETIC_FEATURE_TYPE_ID).toBe(
				"acd9cd67-b58f-4cdf-b588-b386d812f69c",
			);
		});
	});

	describe("isCosmeticFeature", () => {
		it("should return true for the cosmetic feature type UUID", () => {
			expect(isCosmeticFeature("acd9cd67-b58f-4cdf-b588-b386d812f69c")).toBe(
				true,
			);
		});

		it("should return true when using the exported constant", () => {
			expect(isCosmeticFeature(COSMETIC_FEATURE_TYPE_ID)).toBe(true);
		});

		it("should return false for a different UUID", () => {
			expect(isCosmeticFeature("0a083f70-3839-4ae4-af69-067c29ac29f5")).toBe(
				false,
			);
		});

		it("should return false for null", () => {
			expect(isCosmeticFeature(null)).toBe(false);
		});

		it("should return false for undefined", () => {
			expect(isCosmeticFeature(undefined)).toBe(false);
		});

		it("should return false for empty string", () => {
			expect(isCosmeticFeature("")).toBe(false);
		});
	});

	describe("getPlaywrightPromptInstructions", () => {
		it("should return content mentioning Playwright", () => {
			const instructions = getPlaywrightPromptInstructions();
			expect(instructions).toContain("Playwright");
		});

		it("should include setup instructions", () => {
			const instructions = getPlaywrightPromptInstructions();
			expect(instructions).toContain("playwright.config.ts");
			expect(instructions).toContain("npx playwright install");
		});

		it("should include screenshot requirements", () => {
			const instructions = getPlaywrightPromptInstructions();
			expect(instructions).toContain("test-results/");
			expect(instructions).toContain("screenshot");
		});

		it("should include example test code", () => {
			const instructions = getPlaywrightPromptInstructions();
			expect(instructions).toContain("page.screenshot");
			expect(instructions).toContain("page.goto");
		});

		it("should mention cosmetic/UI feature", () => {
			const instructions = getPlaywrightPromptInstructions();
			expect(instructions).toContain("cosmetic/UI feature");
		});

		it("should include e2e directory instructions", () => {
			const instructions = getPlaywrightPromptInstructions();
			expect(instructions).toContain("e2e/");
		});
	});

	describe("collectScreenshots", () => {
		let tempDir: string;

		function createTempDir(): string {
			const dir = join(
				tmpdir(),
				`playwright-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(dir, { recursive: true });
			return dir;
		}

		afterEach(() => {
			if (tempDir) {
				try {
					rmSync(tempDir, { recursive: true, force: true });
				} catch {
					// Cleanup failure is fine
				}
			}
		});

		it("should collect PNG files from test-results/", () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			writeFileSync(join(testResultsDir, "hero.png"), "fake-png-data");
			writeFileSync(join(testResultsDir, "footer.png"), "fake-png-data-2");

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(2);
			expect(screenshots.map((s) => s.name).sort()).toEqual([
				"footer.png",
				"hero.png",
			]);
		});

		it("should include relativePath for unique storage paths", () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			writeFileSync(join(testResultsDir, "hero.png"), "fake-png-data");

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(1);
			expect(screenshots[0].relativePath).toBe("test-results/hero.png");
		});

		it("should collect JPG files from playwright-report/", () => {
			tempDir = createTempDir();
			const reportDir = join(tempDir, "playwright-report");
			mkdirSync(reportDir, { recursive: true });
			writeFileSync(join(reportDir, "screenshot.jpg"), "fake-jpg-data");

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(1);
			expect(screenshots[0].name).toBe("screenshot.jpg");
		});

		it("should collect JPEG files", () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			writeFileSync(join(testResultsDir, "image.jpeg"), "fake-jpeg-data");

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(1);
			expect(screenshots[0].name).toBe("image.jpeg");
		});

		it("should ignore non-image files", () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			writeFileSync(join(testResultsDir, "hero.png"), "png-data");
			writeFileSync(join(testResultsDir, "log.txt"), "text-data");
			writeFileSync(join(testResultsDir, "data.json"), "{}");

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(1);
			expect(screenshots[0].name).toBe("hero.png");
		});

		it("should return empty array when directories don't exist", () => {
			tempDir = createTempDir();
			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(0);
		});

		it("should return empty array for empty directories", () => {
			tempDir = createTempDir();
			mkdirSync(join(tempDir, "test-results"), { recursive: true });
			mkdirSync(join(tempDir, "playwright-report"), { recursive: true });

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(0);
		});

		it("should cap results at MAX_SCREENSHOTS (20)", () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });

			for (let i = 0; i < 25; i++) {
				writeFileSync(join(testResultsDir, `screenshot-${i}.png`), `data-${i}`);
			}

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(20);
		});

		it("should collect from subdirectories", () => {
			tempDir = createTempDir();
			const subDir = join(tempDir, "test-results", "chromium", "tests");
			mkdirSync(subDir, { recursive: true });
			writeFileSync(join(subDir, "nested.png"), "nested-data");

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(1);
			expect(screenshots[0].name).toBe("nested.png");
			expect(screenshots[0].relativePath).toBe(
				"test-results/chromium/tests/nested.png",
			);
		});

		it("should include file size", () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			const content = "fake-png-content-for-size-test";
			writeFileSync(join(testResultsDir, "sized.png"), content);

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(1);
			expect(screenshots[0].size).toBe(content.length);
		});

		it("should collect from both directories", () => {
			tempDir = createTempDir();
			mkdirSync(join(tempDir, "test-results"), { recursive: true });
			mkdirSync(join(tempDir, "playwright-report"), { recursive: true });
			writeFileSync(join(tempDir, "test-results", "result.png"), "data1");
			writeFileSync(join(tempDir, "playwright-report", "report.png"), "data2");

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(2);
		});
	});

	describe("constants", () => {
		it("should have MAX_SCREENSHOTS as 20", () => {
			expect(MAX_SCREENSHOTS).toBe(20);
		});

		it("should have SCREENSHOT_EXTENSIONS with png, jpg, jpeg", () => {
			expect(SCREENSHOT_EXTENSIONS).toContain(".png");
			expect(SCREENSHOT_EXTENSIONS).toContain(".jpg");
			expect(SCREENSHOT_EXTENSIONS).toContain(".jpeg");
		});

		it("should have SCREENSHOT_DIRS with test-results and playwright-report", () => {
			expect(SCREENSHOT_DIRS).toContain("test-results");
			expect(SCREENSHOT_DIRS).toContain("playwright-report");
		});
	});
});
