/**
 * Mock Memory module for testing
 * Provides in-memory implementations of memory functions
 */

import type { Memory, MemoryType } from "../../src/memory/index.js";

// Re-export Memory type for convenience
export type { Memory };

// Configurable state
let mockMemories: Memory[] = [];
let recallError: Error | null = null;
let learnCalls: Array<{
	jobId: string;
	phase: string;
	clientId: string;
	discoveries: {
		patterns?: string[];
		issues?: string[];
		insights?: string[];
	};
}> = [];

export function resetMockMemory(): void {
	mockMemories = [];
	learnCalls = [];
	recallError = null;
}

export function setMockMemories(memories: Memory[]): void {
	mockMemories = memories;
}

export function setRecallError(error: Error): void {
	recallError = error;
}

export function getLearnCalls(): typeof learnCalls {
	return learnCalls;
}

// Mock implementations matching src/memory/index.ts exports

export async function recallForClient(
	_clientId: string,
	_query: string,
	_options?: { limit?: number; memoryTypes?: MemoryType[] },
): Promise<Memory[]> {
	if (recallError) throw recallError;
	return mockMemories;
}

export function formatMemoriesForPrompt(memories: Memory[]): string {
	if (memories.length === 0) return "";
	return `## Relevant Learnings\n\n${memories.map((m) => `- **${m.key}**: ${JSON.stringify(m.value)}`).join("\n")}`;
}

export async function learnFromSpecPhase(
	jobId: string,
	phase: string,
	clientId: string,
	discoveries: {
		patterns?: string[];
		issues?: string[];
		insights?: string[];
	},
): Promise<void> {
	learnCalls.push({ jobId, phase, clientId, discoveries });
}

// Helper to create a mock Memory object for seeding
export function createMockMemory(
	overrides: Partial<Memory> & { key: string },
): Memory {
	const { key, ...rest } = overrides;
	return {
		id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		memoryType: "pattern",
		scope: "global",
		key: key,
		value: {},
		contextKeywords: [],
		confidence: 0.8,
		accessCount: 0,
		lastAccessed: null,
		sourceJobId: null,
		sourcePhase: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...rest,
	};
}
