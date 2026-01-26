/**
 * Mock Improve module for testing
 * Provides configurable auto-improve results
 */

import type { ImproveContext, ImproveResult } from "../../src/spec/improve.js";

// Re-export types for convenience
export type { ImproveContext, ImproveResult };

const DEFAULT_IMPROVE_RESULT: ImproveResult = {
	success: true,
	improvedPlan: {
		architecture: "Improved architecture",
		techDecisions: ["Improved decision"],
		fileStructure: ["src/improved.ts"],
	},
	changesSummary: ["Fixed issues from judge feedback"],
	iteration: 0,
};

let mockImproveResult: ImproveResult = { ...DEFAULT_IMPROVE_RESULT };

let improveCalls: ImproveContext[] = [];

export function resetMockImprove(): void {
	mockImproveResult = { ...DEFAULT_IMPROVE_RESULT };
	improveCalls = [];
}

export function setImproveResult(result: ImproveResult): void {
	mockImproveResult = result;
}

export function getImproveCalls(): ImproveContext[] {
	return improveCalls;
}

export async function autoImprove(ctx: ImproveContext): Promise<ImproveResult> {
	improveCalls.push(ctx);
	return { ...mockImproveResult, iteration: ctx.iteration + 1 };
}
