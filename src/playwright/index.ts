import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createAttachment, uploadToStorage } from "../db/queries.js";

export { isCosmeticFeature } from "./detection.js";

const MAX_SCREENSHOTS = 20;
const SCREENSHOT_EXTENSIONS = [".png", ".jpg", ".jpeg"];
const SCREENSHOT_DIRS = ["test-results", "playwright-report"];

export interface ScreenshotFile {
	path: string;
	name: string;
	size: number;
}

export interface AttachmentRecord {
	id: string;
	url: string | null;
	storagePath: string;
	fileName: string;
}

/**
 * Returns Playwright instructions to inject into the Claude prompt
 * for cosmetic features. Tells Claude to write e2e tests and capture screenshots.
 */
export function getPlaywrightPromptInstructions(): string {
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

/**
 * Scan worktree for screenshot files produced by Playwright tests.
 * Looks in test-results/ and playwright-report/ directories.
 * Returns up to MAX_SCREENSHOTS files.
 */
export function collectScreenshots(worktreePath: string): ScreenshotFile[] {
	const screenshots: ScreenshotFile[] = [];

	for (const dir of SCREENSHOT_DIRS) {
		const dirPath = join(worktreePath, dir);
		try {
			collectFromDir(dirPath, screenshots);
		} catch {
			// Directory doesn't exist or can't be read - skip
		}

		if (screenshots.length >= MAX_SCREENSHOTS) break;
	}

	return screenshots.slice(0, MAX_SCREENSHOTS);
}

function collectFromDir(dirPath: string, results: ScreenshotFile[]): void {
	if (results.length >= MAX_SCREENSHOTS) return;

	let entries: string[];
	try {
		entries = readdirSync(dirPath);
	} catch {
		return;
	}

	for (const entry of entries) {
		if (results.length >= MAX_SCREENSHOTS) return;

		const fullPath = join(dirPath, entry);
		try {
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				collectFromDir(fullPath, results);
			} else if (
				stat.isFile() &&
				SCREENSHOT_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext))
			) {
				results.push({
					path: fullPath,
					name: entry,
					size: stat.size,
				});
			}
		} catch {
			// Skip inaccessible entries
		}
	}
}

/**
 * Upload collected screenshots to Supabase Storage and create attachment records.
 */
export async function uploadScreenshots(
	screenshots: ScreenshotFile[],
	jobId: string,
	featureId: string | null,
): Promise<AttachmentRecord[]> {
	const records: AttachmentRecord[] = [];

	for (const screenshot of screenshots) {
		try {
			const fileBuffer = readFileSync(screenshot.path);
			const contentType = screenshot.name.toLowerCase().endsWith(".png")
				? "image/png"
				: "image/jpeg";

			const storagePath = `jobs/${jobId}/${screenshot.name}`;

			const { publicUrl } = await uploadToStorage(
				"screenshots",
				storagePath,
				fileBuffer,
				contentType,
			);

			const entityType = featureId ? "feature" : "agent_job";
			const entityId = featureId || jobId;

			const attachment = await createAttachment({
				entityType,
				entityId,
				fileName: screenshot.name,
				fileSize: screenshot.size,
				mimeType: contentType,
				storagePath,
				url: publicUrl,
			});

			records.push({
				id: attachment.id,
				url: attachment.url,
				storagePath,
				fileName: screenshot.name,
			});
		} catch (err) {
			console.error(`Failed to upload screenshot ${screenshot.name}:`, err);
			// Continue with remaining screenshots
		}
	}

	return records;
}
