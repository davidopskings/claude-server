/**
 * Mock Improve module for testing
 * Provides configurable auto-improve results
 */

import type { ImproveContext, ImproveResult } from "../../src/spec/improve.js";

// Re-export types for convenience
export type { ImproveContext, ImproveResult };

let mockImproveResult: ImproveResult = {
	success: true,
	improvedPlan: {
		architecture: "Improved architecture",
		techDecisions: ["Improved decision"],
		fileStructure: ["src/improved.ts"],
	},
	changesSummary: ["Fixed issues from judge feedback"],
	iteration: 0,
};

let improveCalls: ImproveContext[] = [];

export function resetMockImprove(): void {
	mockImproveResult = {
		success: true,
		improvedPlan: {
			architecture: "Improved architecture",
			techDecisions: ["Improved decision"],
			fileStructure: ["src/improved.ts"],
		},
		changesSummary: ["Fixed issues from judge feedback"],
		iteration: 0,
	};
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
