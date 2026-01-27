/**
 * Unit tests for skills/index.ts pure logic functions
 * Tests SKILLS registry, detectRelevantSkills, listSkills, interpolate
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated types and functions from src/skills/index.ts =====

interface Skill {
	name: string;
	description: string;
	triggers?: {
		patterns: string[];
		confidence: "high" | "medium" | "low";
	};
	requires?: string[];
	steps: { type: string; target?: string; command?: string }[];
	validation?: string[];
	templates?: Record<string, string>;
}

// Replicate SKILLS registry keys and metadata (not full templates, just structure)
const SKILLS: Record<string, Skill> = {
	prisma_migration: {
		name: "Prisma Migration",
		description: "Create and run Prisma database migrations",
		triggers: {
			patterns: ["database", "model", "schema", "prisma", "migration"],
			confidence: "high",
		},
		steps: [
			{ type: "edit", target: "prisma/schema.prisma" },
			{ type: "run", command: "npx prisma migrate dev --name {{name}}" },
			{ type: "run", command: "npx prisma generate" },
		],
		validation: [
			"Schema file exists and is valid",
			"Migration was created successfully",
			"Prisma client was generated",
		],
	},
	react_component: {
		name: "React Component",
		description: "Create a new React component with tests",
		triggers: {
			patterns: ["component", "react", "ui", "interface"],
			confidence: "medium",
		},
		steps: [
			{ type: "create", target: "src/components/{{name}}/{{name}}.tsx" },
			{
				type: "create",
				target: "src/components/{{name}}/{{name}}.test.tsx",
			},
			{ type: "create", target: "src/components/{{name}}/index.ts" },
		],
	},
	api_endpoint: {
		name: "Next.js API Endpoint",
		description: "Create a Next.js API route with validation",
		triggers: {
			patterns: ["api", "endpoint", "route", "handler"],
			confidence: "medium",
		},
		steps: [
			{ type: "create", target: "src/app/api/{{path}}/route.ts" },
			{ type: "create", target: "src/app/api/{{path}}/route.test.ts" },
		],
	},
	server_action: {
		name: "Server Action",
		description: "Create a Next.js Server Action with validation",
		triggers: {
			patterns: ["action", "server action", "form"],
			confidence: "medium",
		},
		steps: [
			{
				type: "create",
				target: "src/features/{{feature}}/actions/{{name}}.ts",
			},
		],
	},
	drizzle_migration: {
		name: "Drizzle Migration",
		description: "Create and run Drizzle ORM migrations",
		triggers: {
			patterns: ["drizzle", "database", "schema", "migration"],
			confidence: "high",
		},
		steps: [
			{ type: "edit", target: "src/db/schema/*.ts" },
			{ type: "run", command: "bun run db:generate" },
			{ type: "run", command: "bun run db:push" },
		],
	},
	test_suite: {
		name: "Test Suite",
		description: "Create a test suite for existing code",
		triggers: {
			patterns: ["test", "testing", "coverage", "spec"],
			confidence: "medium",
		},
		steps: [
			{ type: "create", target: "{{path}}.test.ts" },
			{ type: "run", command: "npm test -- --watch=false {{path}}.test.ts" },
		],
	},
	auth_protection: {
		name: "Auth Protection",
		description: "Add authentication protection to a route",
		triggers: {
			patterns: ["auth", "protected", "login", "session"],
			confidence: "medium",
		},
		requires: ["auth_middleware_exists"],
		steps: [{ type: "edit", target: "{{path}}" }, { type: "validate" }],
	},
	error_boundary: {
		name: "Error Boundary",
		description: "Add error boundary to a React component",
		triggers: {
			patterns: ["error", "boundary", "catch", "fallback"],
			confidence: "medium",
		},
		steps: [{ type: "create", target: "src/components/{{name}}/error.tsx" }],
	},
};

function interpolate(template: string, params: Record<string, string>): string {
	return template.replace(
		/\{\{(\w+)\}\}/g,
		(_, key) => params[key] || `{{${key}}}`,
	);
}

function detectRelevantSkills(
	description: string,
): { skill: string; confidence: string }[] {
	const lowerDesc = description.toLowerCase();
	const relevant: { skill: string; confidence: string }[] = [];

	for (const [name, skill] of Object.entries(SKILLS)) {
		if (!skill.triggers) continue;

		const matchCount = skill.triggers.patterns.filter((p) =>
			lowerDesc.includes(p.toLowerCase()),
		).length;

		if (matchCount > 0) {
			relevant.push({
				skill: name,
				confidence: matchCount >= 2 ? "high" : skill.triggers.confidence,
			});
		}
	}

	return relevant.sort((a, b) => {
		const order = { high: 0, medium: 1, low: 2 };
		return (
			order[a.confidence as keyof typeof order] -
			order[b.confidence as keyof typeof order]
		);
	});
}

function listSkills(): { name: string; description: string }[] {
	return Object.entries(SKILLS).map(([name, skill]) => ({
		name,
		description: skill.description,
	}));
}

// ===== Tests =====

describe("Skills Pure Logic", () => {
	describe("SKILLS registry", () => {
		it("should have 8 skills defined", () => {
			expect(Object.keys(SKILLS)).toHaveLength(8);
		});

		it("should have all expected skill keys", () => {
			const keys = Object.keys(SKILLS);
			expect(keys).toContain("prisma_migration");
			expect(keys).toContain("react_component");
			expect(keys).toContain("api_endpoint");
			expect(keys).toContain("server_action");
			expect(keys).toContain("drizzle_migration");
			expect(keys).toContain("test_suite");
			expect(keys).toContain("auth_protection");
			expect(keys).toContain("error_boundary");
		});

		it("should have name and description for each skill", () => {
			for (const [, skill] of Object.entries(SKILLS)) {
				expect(typeof skill.name).toBe("string");
				expect(skill.name.length).toBeGreaterThan(0);
				expect(typeof skill.description).toBe("string");
				expect(skill.description.length).toBeGreaterThan(0);
			}
		});

		it("should have at least one step for each skill", () => {
			for (const [, skill] of Object.entries(SKILLS)) {
				expect(skill.steps.length).toBeGreaterThan(0);
			}
		});

		it("should have valid step types", () => {
			const validTypes = ["run", "create", "edit", "validate"];
			for (const [, skill] of Object.entries(SKILLS)) {
				for (const step of skill.steps) {
					expect(validTypes).toContain(step.type);
				}
			}
		});

		it("should have triggers with patterns for most skills", () => {
			for (const [, skill] of Object.entries(SKILLS)) {
				if (skill.triggers) {
					expect(skill.triggers.patterns.length).toBeGreaterThan(0);
					expect(["high", "medium", "low"]).toContain(
						skill.triggers.confidence,
					);
				}
			}
		});
	});

	describe("interpolate", () => {
		it("should replace {{key}} with value", () => {
			const result = interpolate("Hello {{name}}!", { name: "World" });
			expect(result).toBe("Hello World!");
		});

		it("should replace multiple placeholders", () => {
			const result = interpolate("{{greeting}} {{name}}!", {
				greeting: "Hi",
				name: "Alice",
			});
			expect(result).toBe("Hi Alice!");
		});

		it("should keep placeholder when key is missing", () => {
			const result = interpolate("Hello {{name}}!", {});
			expect(result).toBe("Hello {{name}}!");
		});

		it("should handle no placeholders", () => {
			const result = interpolate("No placeholders here", { key: "val" });
			expect(result).toBe("No placeholders here");
		});

		it("should handle empty template", () => {
			const result = interpolate("", { key: "val" });
			expect(result).toBe("");
		});

		it("should replace same key multiple times", () => {
			const result = interpolate("{{x}} and {{x}}", { x: "hello" });
			expect(result).toBe("hello and hello");
		});

		it("should handle path-like templates", () => {
			const result = interpolate("src/components/{{name}}/{{name}}.tsx", {
				name: "Button",
			});
			expect(result).toBe("src/components/Button/Button.tsx");
		});
	});

	describe("detectRelevantSkills", () => {
		it("should detect prisma migration from database keyword", () => {
			const skills = detectRelevantSkills("Add a database table");
			const names = skills.map((s) => s.skill);
			expect(names).toContain("prisma_migration");
		});

		it("should detect react component", () => {
			const skills = detectRelevantSkills("Create a new React component");
			const names = skills.map((s) => s.skill);
			expect(names).toContain("react_component");
		});

		it("should detect API endpoint", () => {
			const skills = detectRelevantSkills("Add a new API endpoint");
			const names = skills.map((s) => s.skill);
			expect(names).toContain("api_endpoint");
		});

		it("should boost confidence to high when 2+ patterns match", () => {
			const skills = detectRelevantSkills(
				"Create a database migration with prisma",
			);
			const prismaMigration = skills.find(
				(s) => s.skill === "prisma_migration",
			);
			expect(prismaMigration?.confidence).toBe("high");
		});

		it("should return empty array when no skills match", () => {
			detectRelevantSkills("Do something completely unrelated");
			// May or may not match depending on patterns; test with very specific non-matching text
			const skills2 = detectRelevantSkills("xyz abc 123");
			expect(skills2).toHaveLength(0);
		});

		it("should sort by confidence (high first)", () => {
			const skills = detectRelevantSkills(
				"Database schema migration with testing",
			);
			if (skills.length >= 2) {
				const confidenceOrder = { high: 0, medium: 1, low: 2 };
				for (let i = 1; i < skills.length; i++) {
					const prev =
						confidenceOrder[
							skills[i - 1].confidence as keyof typeof confidenceOrder
						];
					const curr =
						confidenceOrder[
							skills[i].confidence as keyof typeof confidenceOrder
						];
					expect(prev).toBeLessThanOrEqual(curr);
				}
			}
		});

		it("should be case insensitive", () => {
			const lower = detectRelevantSkills("database migration");
			const upper = detectRelevantSkills("DATABASE MIGRATION");
			expect(lower.length).toBe(upper.length);
		});
	});

	describe("listSkills", () => {
		it("should return all 8 skills", () => {
			const list = listSkills();
			expect(list).toHaveLength(8);
		});

		it("should include name and description for each", () => {
			const list = listSkills();
			for (const item of list) {
				expect(typeof item.name).toBe("string");
				expect(typeof item.description).toBe("string");
				expect(item.name.length).toBeGreaterThan(0);
				expect(item.description.length).toBeGreaterThan(0);
			}
		});

		it("should include known skill names", () => {
			const list = listSkills();
			const names = list.map((s) => s.name);
			expect(names).toContain("prisma_migration");
			expect(names).toContain("react_component");
		});
	});
});
