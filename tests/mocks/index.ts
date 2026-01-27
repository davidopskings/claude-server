/**
 * Test mocks index
 * Re-exports all mocks for easy importing
 */

export * from "./claude.js";
export * from "./db.js";
export * from "./git.js";
export * from "./improve.js";
export * from "./judge.js";
export * from "./memory.js";
export * from "./observability.js";

// Combined reset function for beforeEach
import { resetMockClaude } from "./claude.js";
import { resetMockDb } from "./db.js";
import { resetMockGit } from "./git.js";
import { resetMockImprove } from "./improve.js";
import { resetMockJudge } from "./judge.js";
import { resetMockMemory } from "./memory.js";
import { resetMockObservability } from "./observability.js";

export function resetAllMocks(): void {
	resetMockDb();
	resetMockClaude();
	resetMockGit();
	resetMockMemory();
	resetMockObservability();
	resetMockJudge();
	resetMockImprove();
}
