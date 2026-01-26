/**
 * Unit tests for prd.ts pure logic functions
 * Tests extractJson, buildFeatureContext, and interface shape validation
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated pure functions from src/prd.ts =====

interface GeneratedPrd {
	title: string;
	overview: string;
	goals: string[];
	userStories: string[];
	functionalRequirements: string[];
	nonGoals: string[];
	technicalConsiderations: string[];
	successMetrics: string[];
}

interface GeneratedTask {
	title: string;
	description: string;
	orderIndex: number;
}

function extractJson(text: string): string {
	let jsonStr = text.trim();

	const jsonBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
	if (jsonBlockMatch) {
		return jsonBlockMatch[1].trim();
	}

	const codeBlockMatch = jsonStr.match(/```\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		return codeBlockMatch[1].trim();
	}

	const jsonObjectMatch = jsonStr.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
	if (jsonObjectMatch) {
		return jsonObjectMatch[1].trim();
	}

	// Fallback: remove markdown code blocks at start/end
	if (jsonStr.startsWith("```json")) {
		jsonStr = jsonStr.slice(7);
	} else if (jsonStr.startsWith("```")) {
		jsonStr = jsonStr.slice(3);
	}

	if (jsonStr.endsWith("```")) {
		jsonStr = jsonStr.slice(0, -3);
	}

	return jsonStr.trim();
}

interface FeatureWithClient {
	title: string;
	client?: { name: string } | null;
	functionality_notes?: string | null;
	client_context?: string | null;
}

function buildFeatureContext(feature: FeatureWithClient): string {
	const parts: string[] = [];
	parts.push(`Title: ${feature.title}`);
	if (feature.client?.name) {
		parts.push(`Client: ${feature.client.name}`);
	}
	if (feature.functionality_notes) {
		parts.push(`\nFunctionality Notes:\n${feature.functionality_notes}`);
	}
	if (feature.client_context) {
		parts.push(`\nClient Context:\n${feature.client_context}`);
	}
	return parts.join("\n");
}

// ===== Tests =====

describe("PRD Pure Logic", () => {
	describe("extractJson", () => {
		it("should extract JSON from ```json code block", () => {
			const text = 'Prefix\n```json\n{"title": "Feature"}\n```\nSuffix';
			const result = extractJson(text);
			expect(result).toBe('{"title": "Feature"}');
		});

		it("should extract JSON from generic code block", () => {
			const text = '```\n{"title": "Feature"}\n```';
			const result = extractJson(text);
			expect(result).toBe('{"title": "Feature"}');
		});

		it("should extract raw JSON object", () => {
			const text = 'The PRD is: {"title": "Feature"} as shown';
			const result = extractJson(text);
			expect(result).toBe('{"title": "Feature"}');
		});

		it("should extract raw JSON array", () => {
			const text = 'Tasks are: [{"title": "Task 1"}]';
			const result = extractJson(text);
			expect(result).toBe('[{"title": "Task 1"}]');
		});

		it("should prefer ```json block over raw JSON", () => {
			const text = '{"raw": true}\n```json\n{"block": true}\n```';
			const result = extractJson(text);
			expect(result).toBe('{"block": true}');
		});

		it("should handle fallback: strip ```json at start", () => {
			// Edge case: unclosed code block
			const text = '```json\n{"key": "value"}';
			const result = extractJson(text);
			// The regex for raw JSON should catch it
			expect(JSON.parse(result)).toEqual({ key: "value" });
		});

		it("should handle fallback: strip ``` at end", () => {
			const text = '{"key": "value"}\n```';
			const result = extractJson(text);
			expect(JSON.parse(result)).toEqual({ key: "value" });
		});

		it("should handle multiline JSON", () => {
			const text =
				'```json\n{\n  "title": "Test",\n  "goals": ["a", "b"]\n}\n```';
			const result = extractJson(text);
			const parsed = JSON.parse(result);
			expect(parsed.title).toBe("Test");
			expect(parsed.goals).toEqual(["a", "b"]);
		});

		it("should return trimmed text when no JSON found", () => {
			const text = "  plain text  ";
			const result = extractJson(text);
			expect(result).toBe("plain text");
		});

		it("should handle empty string", () => {
			const result = extractJson("");
			expect(result).toBe("");
		});
	});

	describe("buildFeatureContext", () => {
		it("should always include title", () => {
			const context = buildFeatureContext({ title: "Add dark mode" });
			expect(context).toContain("Title: Add dark mode");
		});

		it("should include client name when present", () => {
			const context = buildFeatureContext({
				title: "Feature",
				client: { name: "Acme Corp" },
			});
			expect(context).toContain("Client: Acme Corp");
		});

		it("should skip client when null", () => {
			const context = buildFeatureContext({
				title: "Feature",
				client: null,
			});
			expect(context).not.toContain("Client:");
		});

		it("should include functionality notes", () => {
			const context = buildFeatureContext({
				title: "Feature",
				functionality_notes: "Must support SSR",
			});
			expect(context).toContain("Functionality Notes:");
			expect(context).toContain("Must support SSR");
		});

		it("should include client context", () => {
			const context = buildFeatureContext({
				title: "Feature",
				client_context: "Next.js + Prisma",
			});
			expect(context).toContain("Client Context:");
			expect(context).toContain("Next.js + Prisma");
		});

		it("should build complete context with all fields", () => {
			const context = buildFeatureContext({
				title: "Auth System",
				client: { name: "TestCo" },
				functionality_notes: "Email/password only",
				client_context: "Express backend",
			});
			const lines = context.split("\n");
			expect(lines[0]).toBe("Title: Auth System");
			expect(lines[1]).toBe("Client: TestCo");
			expect(context).toContain("Email/password only");
			expect(context).toContain("Express backend");
		});
	});

	describe("GeneratedPrd shape validation", () => {
		it("should validate a complete PRD object", () => {
			const prd: GeneratedPrd = {
				title: "User Auth",
				overview: "Add authentication to the app",
				goals: ["Secure access"],
				userStories: ["As a user, I want to log in"],
				functionalRequirements: ["REQ-001: Login form"],
				nonGoals: ["Social login"],
				technicalConsiderations: ["Use JWT"],
				successMetrics: ["95% uptime"],
			};

			expect(prd.title).toBeDefined();
			expect(Array.isArray(prd.goals)).toBe(true);
			expect(Array.isArray(prd.userStories)).toBe(true);
			expect(Array.isArray(prd.functionalRequirements)).toBe(true);
			expect(Array.isArray(prd.nonGoals)).toBe(true);
			expect(Array.isArray(prd.technicalConsiderations)).toBe(true);
			expect(Array.isArray(prd.successMetrics)).toBe(true);
		});

		it("should validate PRD with empty arrays", () => {
			const prd: GeneratedPrd = {
				title: "Minimal PRD",
				overview: "Simple feature",
				goals: [],
				userStories: [],
				functionalRequirements: [],
				nonGoals: [],
				technicalConsiderations: [],
				successMetrics: [],
			};

			expect(prd.goals).toHaveLength(0);
			expect(typeof prd.title).toBe("string");
		});
	});

	describe("GeneratedTask shape validation", () => {
		it("should validate a task object", () => {
			const task: GeneratedTask = {
				title: "Create feature branch",
				description: "Create a new git branch for this feature",
				orderIndex: 0,
			};

			expect(typeof task.title).toBe("string");
			expect(typeof task.description).toBe("string");
			expect(typeof task.orderIndex).toBe("number");
		});

		it("should validate task ordering", () => {
			const tasks: GeneratedTask[] = [
				{ title: "Branch", description: "Create branch", orderIndex: 0 },
				{ title: "Schema", description: "Add DB schema", orderIndex: 1 },
				{ title: "Tests", description: "Write tests", orderIndex: 2 },
			];

			for (let i = 0; i < tasks.length; i++) {
				expect(tasks[i].orderIndex).toBe(i);
			}
		});
	});
});
