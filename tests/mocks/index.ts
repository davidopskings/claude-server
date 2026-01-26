/**
 * Test mocks index
 * Re-exports all mocks for easy importing
 */

export * from "./claude.js";
export * from "./db.js";
export * from "./git.js";

// Combined reset function for beforeEach
import { resetMockClaude } from "./claude.js";
import { resetMockDb } from "./db.js";
import { resetMockGit } from "./git.js";

export function resetAllMocks(): void {
	resetMockDb();
	resetMockClaude();
	resetMockGit();
}
