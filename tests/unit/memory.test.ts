/**
 * Unit tests for memory/index.ts pure logic functions
 * Tests buildScope, formatMemoriesForPrompt, extractKeywords, mapMemory
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated types and functions from src/memory/index.ts =====

type MemoryType = "pattern" | "error" | "insight" | "preference" | "codebase";

interface Memory {
	id: string;
	memoryType: MemoryType;
	scope: string;
	key: string;
	value: Record<string, unknown>;
	contextKeywords: string[];
	confidence: number;
	accessCount: number;
	lastAccessed: string | null;
	sourceJobId: string | null;
	sourcePhase: string | null;
	createdAt: string;
	updatedAt: string;
}

interface AgentMemoryRow {
	id: string;
	memory_type: string;
	scope: string;
	key: string;
	value: unknown;
	context_keywords: string[] | null;
	confidence: number | null;
	access_count: number | null;
	last_accessed: string | null;
	source_job_id: string | null;
	source_phase: string | null;
	created_at: string | null;
	updated_at: string | null;
}

function buildScope(
	type: "global" | "client" | "repo" | "feature",
	id?: string,
): string {
	if (type === "global") return "global";
	if (!id) throw new Error(`ID required for scope type: ${type}`);
	return `${type}:${id}`;
}

function extractKeywords(query: unknown): string[] {
	let queryStr: string;
	if (typeof query !== "string") {
		if (query && typeof query === "object") {
			queryStr = JSON.stringify(query);
		} else {
			return [];
		}
	} else {
		queryStr = query;
	}
	return queryStr
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length >= 3)
		.slice(0, 20);
}

function mapMemory(row: AgentMemoryRow): Memory {
	return {
		id: row.id,
		memoryType: row.memory_type as MemoryType,
		scope: row.scope,
		key: row.key,
		value:
			typeof row.value === "object" && row.value !== null
				? (row.value as Record<string, unknown>)
				: {},
		contextKeywords: row.context_keywords || [],
		confidence: row.confidence ?? 0.5,
		accessCount: row.access_count ?? 0,
		lastAccessed: row.last_accessed,
		sourceJobId: row.source_job_id,
		sourcePhase: row.source_phase,
		createdAt: row.created_at ?? new Date().toISOString(),
		updatedAt: row.updated_at ?? new Date().toISOString(),
	};
}

function formatMemoriesForPrompt(memories: Memory[]): string {
	if (memories.length === 0) return "";

	const grouped: Record<MemoryType, Memory[]> = {
		pattern: [],
		error: [],
		insight: [],
		preference: [],
		codebase: [],
	};

	for (const memory of memories) {
		grouped[memory.memoryType].push(memory);
	}

	const sections: string[] = [];

	if (grouped.pattern.length > 0) {
		sections.push(
			"### Patterns\n" +
				grouped.pattern
					.map((m) => `- **${m.key}**: ${JSON.stringify(m.value)}`)
					.join("\n"),
		);
	}

	if (grouped.error.length > 0) {
		sections.push(
			"### Known Issues to Avoid\n" +
				grouped.error
					.map((m) => `- **${m.key}**: ${JSON.stringify(m.value)}`)
					.join("\n"),
		);
	}

	if (grouped.insight.length > 0) {
		sections.push(
			"### Insights\n" +
				grouped.insight
					.map((m) => `- **${m.key}**: ${JSON.stringify(m.value)}`)
					.join("\n"),
		);
	}

	if (grouped.preference.length > 0) {
		sections.push(
			"### Preferences\n" +
				grouped.preference
					.map((m) => `- **${m.key}**: ${JSON.stringify(m.value)}`)
					.join("\n"),
		);
	}

	if (grouped.codebase.length > 0) {
		sections.push(
			"### Codebase Knowledge\n" +
				grouped.codebase
					.map((m) => `- **${m.key}**: ${JSON.stringify(m.value)}`)
					.join("\n"),
		);
	}

	return `## Relevant Learnings\n\n${sections.join("\n\n")}`;
}

// ===== Helper to create test Memory objects =====

function createMemory(
	overrides: Partial<Memory> & { memoryType: MemoryType; key: string },
): Memory {
	return {
		id: overrides.id || "mem-1",
		memoryType: overrides.memoryType,
		scope: overrides.scope || "global",
		key: overrides.key,
		value: overrides.value || {},
		contextKeywords: overrides.contextKeywords || [],
		confidence: overrides.confidence ?? 0.8,
		accessCount: overrides.accessCount ?? 1,
		lastAccessed: overrides.lastAccessed || null,
		sourceJobId: overrides.sourceJobId || null,
		sourcePhase: overrides.sourcePhase || null,
		createdAt: overrides.createdAt || "2026-01-01T00:00:00Z",
		updatedAt: overrides.updatedAt || "2026-01-01T00:00:00Z",
	};
}

// ===== Tests =====

describe("Memory Pure Logic", () => {
	describe("buildScope", () => {
		it("should return 'global' for global type", () => {
			expect(buildScope("global")).toBe("global");
		});

		it("should return 'global' for global type even with id", () => {
			expect(buildScope("global", "some-id")).toBe("global");
		});

		it("should return 'client:id' for client type", () => {
			expect(buildScope("client", "client-123")).toBe("client:client-123");
		});

		it("should return 'repo:id' for repo type", () => {
			expect(buildScope("repo", "repo-abc")).toBe("repo:repo-abc");
		});

		it("should return 'feature:id' for feature type", () => {
			expect(buildScope("feature", "feat-456")).toBe("feature:feat-456");
		});

		it("should throw when client type has no id", () => {
			expect(() => buildScope("client")).toThrow("ID required");
		});

		it("should throw when repo type has no id", () => {
			expect(() => buildScope("repo")).toThrow("ID required");
		});

		it("should throw when feature type has no id", () => {
			expect(() => buildScope("feature")).toThrow("ID required");
		});
	});

	describe("extractKeywords", () => {
		it("should extract words of 3+ characters", () => {
			const keywords = extractKeywords("Add a new feature to the app");
			expect(keywords).toContain("add");
			expect(keywords).toContain("new");
			expect(keywords).toContain("feature");
			expect(keywords).toContain("the");
			expect(keywords).toContain("app");
		});

		it("should filter out short words", () => {
			const keywords = extractKeywords("I am at it");
			expect(keywords).toHaveLength(0);
		});

		it("should lowercase all keywords", () => {
			const keywords = extractKeywords("TypeScript React Node");
			expect(keywords).toContain("typescript");
			expect(keywords).toContain("react");
			expect(keywords).toContain("node");
		});

		it("should replace special characters with spaces", () => {
			const keywords = extractKeywords("user-authentication@login");
			expect(keywords).toContain("user");
			expect(keywords).toContain("authentication");
			expect(keywords).toContain("login");
		});

		it("should limit to 20 keywords", () => {
			const longText = Array.from({ length: 30 }, (_, i) => `keyword${i}`).join(
				" ",
			);
			const keywords = extractKeywords(longText);
			expect(keywords.length).toBeLessThanOrEqual(20);
		});

		it("should handle object input by stringifying", () => {
			const keywords = extractKeywords({ type: "pattern", value: "test" });
			expect(keywords.length).toBeGreaterThan(0);
			expect(keywords).toContain("type");
		});

		it("should return empty array for null", () => {
			const keywords = extractKeywords(null);
			expect(keywords).toEqual([]);
		});

		it("should return empty array for undefined", () => {
			const keywords = extractKeywords(undefined);
			expect(keywords).toEqual([]);
		});

		it("should return empty array for number", () => {
			const keywords = extractKeywords(42);
			expect(keywords).toEqual([]);
		});

		it("should handle empty string", () => {
			const keywords = extractKeywords("");
			expect(keywords).toEqual([]);
		});
	});

	describe("mapMemory", () => {
		it("should map all fields from database row", () => {
			const row: AgentMemoryRow = {
				id: "mem-1",
				memory_type: "pattern",
				scope: "global",
				key: "test-key",
				value: { pattern: "use strict" },
				context_keywords: ["typescript", "strict"],
				confidence: 0.9,
				access_count: 5,
				last_accessed: "2026-01-15T00:00:00Z",
				source_job_id: "job-1",
				source_phase: "constitution",
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-10T00:00:00Z",
			};

			const memory = mapMemory(row);
			expect(memory.id).toBe("mem-1");
			expect(memory.memoryType).toBe("pattern");
			expect(memory.scope).toBe("global");
			expect(memory.key).toBe("test-key");
			expect(memory.value).toEqual({ pattern: "use strict" });
			expect(memory.contextKeywords).toEqual(["typescript", "strict"]);
			expect(memory.confidence).toBe(0.9);
			expect(memory.accessCount).toBe(5);
			expect(memory.sourceJobId).toBe("job-1");
			expect(memory.sourcePhase).toBe("constitution");
		});

		it("should default confidence to 0.5 when null", () => {
			const row: AgentMemoryRow = {
				id: "mem-2",
				memory_type: "error",
				scope: "client:c1",
				key: "error-key",
				value: {},
				context_keywords: null,
				confidence: null,
				access_count: null,
				last_accessed: null,
				source_job_id: null,
				source_phase: null,
				created_at: null,
				updated_at: null,
			};

			const memory = mapMemory(row);
			expect(memory.confidence).toBe(0.5);
		});

		it("should default access_count to 0 when null", () => {
			const row: AgentMemoryRow = {
				id: "mem-3",
				memory_type: "insight",
				scope: "global",
				key: "k",
				value: {},
				context_keywords: null,
				confidence: null,
				access_count: null,
				last_accessed: null,
				source_job_id: null,
				source_phase: null,
				created_at: null,
				updated_at: null,
			};

			const memory = mapMemory(row);
			expect(memory.accessCount).toBe(0);
		});

		it("should default context_keywords to empty array when null", () => {
			const row: AgentMemoryRow = {
				id: "mem-4",
				memory_type: "preference",
				scope: "global",
				key: "k",
				value: {},
				context_keywords: null,
				confidence: 0.5,
				access_count: 0,
				last_accessed: null,
				source_job_id: null,
				source_phase: null,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			};

			const memory = mapMemory(row);
			expect(memory.contextKeywords).toEqual([]);
		});

		it("should handle non-object value by returning empty object", () => {
			const row: AgentMemoryRow = {
				id: "mem-5",
				memory_type: "codebase",
				scope: "global",
				key: "k",
				value: "string value" as unknown,
				context_keywords: [],
				confidence: 0.5,
				access_count: 0,
				last_accessed: null,
				source_job_id: null,
				source_phase: null,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			};

			const memory = mapMemory(row);
			expect(memory.value).toEqual({});
		});
	});

	describe("formatMemoriesForPrompt", () => {
		it("should return empty string for empty array", () => {
			expect(formatMemoriesForPrompt([])).toBe("");
		});

		it("should format pattern memories", () => {
			const memories = [
				createMemory({
					memoryType: "pattern",
					key: "naming",
					value: { convention: "camelCase" },
				}),
			];
			const result = formatMemoriesForPrompt(memories);
			expect(result).toContain("## Relevant Learnings");
			expect(result).toContain("### Patterns");
			expect(result).toContain("**naming**");
			expect(result).toContain("camelCase");
		});

		it("should format error memories", () => {
			const memories = [
				createMemory({
					memoryType: "error",
					key: "import-bug",
					value: { issue: "circular import" },
				}),
			];
			const result = formatMemoriesForPrompt(memories);
			expect(result).toContain("### Known Issues to Avoid");
			expect(result).toContain("**import-bug**");
		});

		it("should format insight memories", () => {
			const memories = [
				createMemory({
					memoryType: "insight",
					key: "perf-tip",
					value: { tip: "use memo" },
				}),
			];
			const result = formatMemoriesForPrompt(memories);
			expect(result).toContain("### Insights");
		});

		it("should format preference memories", () => {
			const memories = [
				createMemory({
					memoryType: "preference",
					key: "style",
					value: { tabs: true },
				}),
			];
			const result = formatMemoriesForPrompt(memories);
			expect(result).toContain("### Preferences");
		});

		it("should format codebase memories", () => {
			const memories = [
				createMemory({
					memoryType: "codebase",
					key: "structure",
					value: { pattern: "MVC" },
				}),
			];
			const result = formatMemoriesForPrompt(memories);
			expect(result).toContain("### Codebase Knowledge");
		});

		it("should group multiple memories by type", () => {
			const memories = [
				createMemory({
					id: "m1",
					memoryType: "pattern",
					key: "p1",
					value: { v: 1 },
				}),
				createMemory({
					id: "m2",
					memoryType: "pattern",
					key: "p2",
					value: { v: 2 },
				}),
				createMemory({
					id: "m3",
					memoryType: "error",
					key: "e1",
					value: { v: 3 },
				}),
			];
			const result = formatMemoriesForPrompt(memories);
			expect(result).toContain("### Patterns");
			expect(result).toContain("### Known Issues to Avoid");
			expect(result).toContain("**p1**");
			expect(result).toContain("**p2**");
			expect(result).toContain("**e1**");
		});

		it("should skip empty memory type groups", () => {
			const memories = [
				createMemory({ memoryType: "pattern", key: "only-pattern" }),
			];
			const result = formatMemoriesForPrompt(memories);
			expect(result).toContain("### Patterns");
			expect(result).not.toContain("### Known Issues to Avoid");
			expect(result).not.toContain("### Insights");
			expect(result).not.toContain("### Preferences");
			expect(result).not.toContain("### Codebase Knowledge");
		});
	});
});
