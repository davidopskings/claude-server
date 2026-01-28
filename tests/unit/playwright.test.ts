/**
 * Unit tests for src/playwright/index.ts
 * Tests isCosmeticFeature, getPlaywrightPromptInstructions, collectScreenshots
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock db/client.js before any imports that depend on it
mock.module("../../src/db/client.js", () => ({
	supabase: {
		from: () => ({ select: () => ({ eq: () => ({ data: null }) }) }),
		storage: {
			from: () => ({
				upload: async () => ({ data: { path: "mock-path" }, error: null }),
				getPublicUrl: () => ({ data: { publicUrl: "mock-url" } }),
			}),
		},
	},
}));

// Mock db/queries.ts
mock.module("../../src/db/queries.js", () => ({
	createAttachment: async () => ({ id: "mock-id", url: "mock-url" }),
	uploadToStorage: async () => ({
		storagePath: "mock-path",
		publicUrl: "mock-url",
	}),
}));

// Import actual implementations from the source
import {
	COSMETIC_FEATURE_TYPE_ID,
	clearUploadTracking,
	collectScreenshots,
	getPlaywrightPromptInstructions,
	isCosmeticFeature,
	MAX_SCREENSHOTS,
	SCREENSHOT_DIRS,
	SCREENSHOT_EXTENSIONS,
	uploadScreenshots,
} from "../../src/playwright/index.js";

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

		it("should cap results at MAX_SCREENSHOTS", () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });

			for (let i = 0; i < MAX_SCREENSHOTS + 5; i++) {
				writeFileSync(join(testResultsDir, `screenshot-${i}.png`), `data-${i}`);
			}

			const screenshots = collectScreenshots(tempDir);
			expect(screenshots).toHaveLength(MAX_SCREENSHOTS);
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

	describe("uploadScreenshots", () => {
		let tempDir: string;

		function createTempDir(): string {
			const dir = join(
				tmpdir(),
				`playwright-upload-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(dir, { recursive: true });
			return dir;
		}

		beforeEach(() => {
			// Clear upload tracking before each test
			clearUploadTracking("test-job-id");
		});

		afterEach(() => {
			if (tempDir) {
				try {
					rmSync(tempDir, { recursive: true, force: true });
				} catch {
					// Cleanup failure is fine
				}
			}
		});

		it("should upload screenshots and return attachment records", async () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			writeFileSync(join(testResultsDir, "test.png"), "test-data");

			const screenshots = collectScreenshots(tempDir);
			const records = await uploadScreenshots(
				screenshots,
				"test-job-id",
				"test-feature-id",
			);

			expect(records).toHaveLength(1);
			expect(records[0]).toHaveProperty("id");
			expect(records[0]).toHaveProperty("url");
			expect(records[0]).toHaveProperty("storagePath");
			expect(records[0]).toHaveProperty("fileName");
		});

		it("should deduplicate uploads across iterations", async () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			writeFileSync(join(testResultsDir, "test.png"), "test-data");

			const screenshots = collectScreenshots(tempDir);

			// First upload
			const records1 = await uploadScreenshots(
				screenshots,
				"test-job-id",
				"test-feature-id",
			);
			expect(records1).toHaveLength(1);

			// Second upload should be deduplicated
			const records2 = await uploadScreenshots(
				screenshots,
				"test-job-id",
				"test-feature-id",
			);
			expect(records2).toHaveLength(0);
		});

		it("should track uploads per job independently", async () => {
			tempDir = createTempDir();
			const testResultsDir = join(tempDir, "test-results");
			mkdirSync(testResultsDir, { recursive: true });
			writeFileSync(join(testResultsDir, "test.png"), "test-data");

			const screenshots = collectScreenshots(tempDir);

			// Upload for job 1
			const records1 = await uploadScreenshots(
				screenshots,
				"job-1",
				"feature-1",
			);
			expect(records1).toHaveLength(1);

			// Upload for job 2 should also upload (different job)
			const records2 = await uploadScreenshots(
				screenshots,
				"job-2",
				"feature-2",
			);
			expect(records2).toHaveLength(1);

			// Clean up
			clearUploadTracking("job-1");
			clearUploadTracking("job-2");
		});
	});

	describe("exported constants", () => {
		it("should export MAX_SCREENSHOTS as 20", () => {
			expect(MAX_SCREENSHOTS).toBe(20);
		});

		it("should export SCREENSHOT_EXTENSIONS with png, jpg, jpeg", () => {
			expect(SCREENSHOT_EXTENSIONS).toContain(".png");
			expect(SCREENSHOT_EXTENSIONS).toContain(".jpg");
			expect(SCREENSHOT_EXTENSIONS).toContain(".jpeg");
		});

		it("should export SCREENSHOT_DIRS with test-results and playwright-report", () => {
			expect(SCREENSHOT_DIRS).toContain("test-results");
			expect(SCREENSHOT_DIRS).toContain("playwright-report");
		});
	});
});
