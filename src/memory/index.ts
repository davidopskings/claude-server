/**
 * Persistent Memory Layer
 *
 * Cross-session, cross-client learnings that compound over time.
 * Memories are stored in the database and retrieved based on relevance.
 */

import { supabase } from "../db/index.js";

export type MemoryType =
	| "pattern"
	| "error"
	| "insight"
	| "preference"
	| "codebase";

export interface Memory {
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

export interface MemoryInput {
	memoryType: MemoryType;
	scope: string;
	key: string;
	value: Record<string, unknown>;
	contextKeywords?: string[];
	sourceJobId?: string;
	sourcePhase?: string;
}

// Database row type (from agent_memory table - migration 004)
// Using the actual Supabase generated type shape
import type { Database } from "../types/supabase.js";

type AgentMemoryRow = Database["public"]["Tables"]["agent_memory"]["Row"];

/**
 * Build scope string for different contexts
 */
export function buildScope(
	type: "global" | "client" | "repo" | "feature",
	id?: string,
): string {
	if (type === "global") return "global";
	if (!id) throw new Error(`ID required for scope type: ${type}`);
	return `${type}:${id}`;
}

/**
 * Store a new memory or update confidence if it already exists
 */
export async function learn(input: MemoryInput): Promise<Memory> {
	const {
		memoryType,
		scope,
		key,
		value,
		contextKeywords = [],
		sourceJobId,
		sourcePhase,
	} = input;

	// Check if memory already exists
	const { data: existing } = await supabase
		.from("agent_memory")
		.select("*")
		.eq("memory_type", memoryType)
		.eq("scope", scope)
		.eq("key", key)
		.single();

	if (existing) {
		// Update confidence (max 1.0) and merge value
		const existingConfidence = existing.confidence ?? 0.5;
		const newConfidence = Math.min(1.0, existingConfidence + 0.1);
		const existingValue =
			typeof existing.value === "object" && existing.value !== null
				? (existing.value as Record<string, unknown>)
				: {};
		const mergedValue = { ...existingValue, ...value };
		const existingKeywords = existing.context_keywords ?? [];

		const { data, error } = await supabase
			.from("agent_memory")
			.update({
				value:
					mergedValue as Database["public"]["Tables"]["agent_memory"]["Update"]["value"],
				confidence: newConfidence,
				context_keywords: [
					...new Set([...existingKeywords, ...contextKeywords]),
				],
				updated_at: new Date().toISOString(),
			})
			.eq("id", existing.id)
			.select()
			.single();

		if (error || !data) throw error ?? new Error("No data returned");
		return mapMemory(data);
	}

	// Create new memory
	const { data, error } = await supabase
		.from("agent_memory")
		.insert({
			memory_type: memoryType,
			scope,
			key,
			value:
				value as Database["public"]["Tables"]["agent_memory"]["Insert"]["value"],
			context_keywords: contextKeywords,
			source_job_id: sourceJobId,
			source_phase: sourcePhase,
		})
		.select()
		.single();

	if (error || !data) throw error ?? new Error("No data returned");
	return mapMemory(data);
}

/**
 * Recall memories relevant to a query
 */
export async function recall(
	query: string,
	options: {
		scope?: string;
		scopes?: string[];
		memoryTypes?: MemoryType[];
		limit?: number;
		minConfidence?: number;
	} = {},
): Promise<Memory[]> {
	const {
		scope,
		scopes = scope ? [scope, "global"] : ["global"],
		memoryTypes,
		limit = 10,
		minConfidence = 0.5,
	} = options;

	// Extract keywords from query for matching
	const keywords = extractKeywords(query);

	let queryBuilder = supabase
		.from("agent_memory")
		.select("*")
		.in("scope", scopes)
		.gte("confidence", minConfidence)
		.order("confidence", { ascending: false })
		.order("access_count", { ascending: false })
		.limit(limit);

	if (memoryTypes && memoryTypes.length > 0) {
		queryBuilder = queryBuilder.in("memory_type", memoryTypes);
	}

	// Use keyword overlap for relevance
	if (keywords.length > 0) {
		queryBuilder = queryBuilder.overlaps("context_keywords", keywords);
	}

	const { data, error } = await queryBuilder;

	if (error) throw error;

	// Update access tracking for retrieved memories
	if (data && data.length > 0) {
		const ids = data.map((m) => m.id);
		await markAccessed(ids);
	}

	return (data || []).map(mapMemory);
}

/**
 * Recall memories for a specific client context
 */
export async function recallForClient(
	clientId: string,
	query: string,
	options: { limit?: number; memoryTypes?: MemoryType[] } = {},
): Promise<Memory[]> {
	return recall(query, {
		scopes: [`client:${clientId}`, "global"],
		...options,
	});
}

/**
 * Recall memories for a specific repository
 */
export async function recallForRepo(
	repoId: string,
	clientId: string,
	query: string,
	options: { limit?: number; memoryTypes?: MemoryType[] } = {},
): Promise<Memory[]> {
	return recall(query, {
		scopes: [`repo:${repoId}`, `client:${clientId}`, "global"],
		...options,
	});
}

/**
 * Get all memories for a specific scope
 */
export async function getMemoriesByScope(
	scope: string,
	options: { memoryTypes?: MemoryType[]; limit?: number } = {},
): Promise<Memory[]> {
	const { memoryTypes, limit = 50 } = options;

	let queryBuilder = supabase
		.from("agent_memory")
		.select("*")
		.eq("scope", scope)
		.order("confidence", { ascending: false })
		.limit(limit);

	if (memoryTypes && memoryTypes.length > 0) {
		queryBuilder = queryBuilder.in("memory_type", memoryTypes);
	}

	const { data, error } = await queryBuilder;
	if (error) throw error;
	return (data || []).map(mapMemory);
}

/**
 * Delete a memory
 */
export async function forget(memoryId: string): Promise<void> {
	const { error } = await supabase
		.from("agent_memory")
		.delete()
		.eq("id", memoryId);

	if (error) throw error;
}

/**
 * Decrease confidence of a memory (when it's found to be incorrect)
 */
export async function decreaseConfidence(
	memoryId: string,
	amount = 0.2,
): Promise<void> {
	const { data: existing } = await supabase
		.from("agent_memory")
		.select("confidence")
		.eq("id", memoryId)
		.single();

	if (!existing) return;

	const currentConfidence = existing.confidence ?? 0.5;
	const newConfidence = Math.max(0, currentConfidence - amount);

	// If confidence drops to 0, delete the memory
	if (newConfidence <= 0) {
		await forget(memoryId);
		return;
	}

	await supabase
		.from("agent_memory")
		.update({ confidence: newConfidence, updated_at: new Date().toISOString() })
		.eq("id", memoryId);
}

/**
 * Mark memories as accessed (updates access_count and last_accessed)
 * Uses RPC function from migration 0011 for atomic increment
 */
async function markAccessed(ids: string[]): Promise<void> {
	for (const id of ids) {
		// RPC function exists in DB (migration 0011) but not in generated types yet
		// biome-ignore lint/suspicious/noExplicitAny: RPC function not in generated types
		await (supabase as any).rpc("increment_memory_access", { memory_id: id });
	}
}

/**
 * Extract keywords from a query string
 */
function extractKeywords(query: unknown): string[] {
	// Handle non-string input
	let queryStr: string;
	if (typeof query !== "string") {
		if (query && typeof query === "object") {
			// Try to stringify object and extract from that
			queryStr = JSON.stringify(query);
		} else {
			return [];
		}
	} else {
		queryStr = query;
	}
	// Simple keyword extraction - split, lowercase, filter short words
	return queryStr
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length >= 3)
		.slice(0, 20); // Limit to 20 keywords
}

/**
 * Map database row to Memory interface
 */
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

/**
 * Format memories for injection into prompts
 */
export function formatMemoriesForPrompt(memories: Memory[]): string {
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

/**
 * Learn from a completed spec phase
 */
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
	const scope = `client:${clientId}`;

	if (discoveries.patterns) {
		for (const pattern of discoveries.patterns) {
			await learn({
				memoryType: "pattern",
				scope,
				key: `spec_${phase}_${Date.now()}`,
				value: { pattern, phase },
				contextKeywords: [phase, ...extractKeywords(pattern)],
				sourceJobId: jobId,
				sourcePhase: phase,
			});
		}
	}

	if (discoveries.issues) {
		for (const issue of discoveries.issues) {
			await learn({
				memoryType: "error",
				scope,
				key: `issue_${phase}_${Date.now()}`,
				value: { issue, phase },
				contextKeywords: [phase, ...extractKeywords(issue)],
				sourceJobId: jobId,
				sourcePhase: phase,
			});
		}
	}

	if (discoveries.insights) {
		for (const insight of discoveries.insights) {
			await learn({
				memoryType: "insight",
				scope,
				key: `insight_${phase}_${Date.now()}`,
				value: { insight, phase },
				contextKeywords: [phase, ...extractKeywords(insight)],
				sourceJobId: jobId,
				sourcePhase: phase,
			});
		}
	}
}
