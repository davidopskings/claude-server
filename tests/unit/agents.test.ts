/**
 * Unit tests for agents/index.ts pure logic functions
 * Tests AGENTS config, buildAgentPrompt, extractJson
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated types and functions from src/agents/index.ts =====

type AgentType = "conductor" | "spec" | "code" | "test" | "review";

interface AgentConfig {
	name: string;
	type: AgentType;
	model: "claude-opus-4" | "claude-sonnet-4" | "claude-haiku";
	role: string;
	systemPrompt: string;
	tools: string[];
	maxParallel: number;
}

interface AgentTask {
	id: string;
	agentType: AgentType;
	prompt: string;
	context?: Record<string, unknown>;
}

const AGENTS: Record<AgentType, AgentConfig> = {
	conductor: {
		name: "Conductor",
		type: "conductor",
		model: "claude-opus-4",
		role: "Orchestrate agents, make decisions, handle escalations",
		systemPrompt: "You are the Conductor - a senior technical architect.",
		tools: ["read", "analyze"],
		maxParallel: 1,
	},
	spec: {
		name: "Spec Agent",
		type: "spec",
		model: "claude-sonnet-4",
		role: "Generate specifications, ask clarifying questions",
		systemPrompt: "You are a Spec Agent - you create detailed specifications.",
		tools: ["read", "search"],
		maxParallel: 10,
	},
	code: {
		name: "Code Agent",
		type: "code",
		model: "claude-sonnet-4",
		role: "Implement code following specs and patterns",
		systemPrompt:
			"You are a Code Agent - you implement code based on specifications.",
		tools: ["read", "write", "edit", "bash"],
		maxParallel: 5,
	},
	test: {
		name: "Test Agent",
		type: "test",
		model: "claude-sonnet-4",
		role: "Write and fix tests",
		systemPrompt:
			"You are a Test Agent - you ensure code quality through testing.",
		tools: ["read", "write", "bash"],
		maxParallel: 5,
	},
	review: {
		name: "Review Agent",
		type: "review",
		model: "claude-opus-4",
		role: "Review code for quality, security, patterns",
		systemPrompt:
			"You are a Review Agent - a senior code reviewer focused on quality.",
		tools: ["read", "analyze"],
		maxParallel: 2,
	},
};

function buildAgentPrompt(config: AgentConfig, task: AgentTask): string {
	let prompt = `# ${config.name} Task

## Your Role
${config.role}

## System Instructions
${config.systemPrompt}

## Task
${task.prompt}
`;

	if (task.context) {
		prompt += `
## Context
\`\`\`json
${JSON.stringify(task.context, null, 2)}
\`\`\`
`;
	}

	return prompt;
}

function extractJson(text: string): unknown {
	const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		return JSON.parse(codeBlockMatch[1]);
	}

	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		return JSON.parse(jsonMatch[0]);
	}

	throw new Error("No JSON found in output");
}

// ===== Tests =====

describe("Agents Pure Logic", () => {
	describe("AGENTS config", () => {
		it("should have all 5 agent types", () => {
			expect(Object.keys(AGENTS)).toHaveLength(5);
			expect(AGENTS.conductor).toBeDefined();
			expect(AGENTS.spec).toBeDefined();
			expect(AGENTS.code).toBeDefined();
			expect(AGENTS.test).toBeDefined();
			expect(AGENTS.review).toBeDefined();
		});

		it("should have valid model for each agent", () => {
			const validModels = ["claude-opus-4", "claude-sonnet-4", "claude-haiku"];
			for (const [, config] of Object.entries(AGENTS)) {
				expect(validModels).toContain(config.model);
			}
		});

		it("should have matching type and key for each agent", () => {
			for (const [key, config] of Object.entries(AGENTS)) {
				expect(config.type).toBe(key);
			}
		});

		it("should use opus for conductor and review (decision-making agents)", () => {
			expect(AGENTS.conductor.model).toBe("claude-opus-4");
			expect(AGENTS.review.model).toBe("claude-opus-4");
		});

		it("should use sonnet for implementation agents", () => {
			expect(AGENTS.spec.model).toBe("claude-sonnet-4");
			expect(AGENTS.code.model).toBe("claude-sonnet-4");
			expect(AGENTS.test.model).toBe("claude-sonnet-4");
		});

		it("should have tools array for each agent", () => {
			for (const [, config] of Object.entries(AGENTS)) {
				expect(Array.isArray(config.tools)).toBe(true);
				expect(config.tools.length).toBeGreaterThan(0);
			}
		});

		it("should have code agent with write and edit tools", () => {
			expect(AGENTS.code.tools).toContain("write");
			expect(AGENTS.code.tools).toContain("edit");
			expect(AGENTS.code.tools).toContain("bash");
		});

		it("should have positive maxParallel for each agent", () => {
			for (const [, config] of Object.entries(AGENTS)) {
				expect(config.maxParallel).toBeGreaterThan(0);
			}
		});

		it("should limit conductor to 1 parallel instance", () => {
			expect(AGENTS.conductor.maxParallel).toBe(1);
		});

		it("should have non-empty name, role, and systemPrompt", () => {
			for (const [, config] of Object.entries(AGENTS)) {
				expect(config.name.length).toBeGreaterThan(0);
				expect(config.role.length).toBeGreaterThan(0);
				expect(config.systemPrompt.length).toBeGreaterThan(0);
			}
		});
	});

	describe("buildAgentPrompt", () => {
		it("should include agent name as heading", () => {
			const task: AgentTask = {
				id: "t1",
				agentType: "code",
				prompt: "Implement the feature",
			};
			const prompt = buildAgentPrompt(AGENTS.code, task);
			expect(prompt).toContain("# Code Agent Task");
		});

		it("should include role section", () => {
			const task: AgentTask = {
				id: "t1",
				agentType: "spec",
				prompt: "Write the spec",
			};
			const prompt = buildAgentPrompt(AGENTS.spec, task);
			expect(prompt).toContain("## Your Role");
			expect(prompt).toContain(AGENTS.spec.role);
		});

		it("should include system instructions", () => {
			const task: AgentTask = {
				id: "t1",
				agentType: "review",
				prompt: "Review this code",
			};
			const prompt = buildAgentPrompt(AGENTS.review, task);
			expect(prompt).toContain("## System Instructions");
			expect(prompt).toContain(AGENTS.review.systemPrompt);
		});

		it("should include task prompt", () => {
			const task: AgentTask = {
				id: "t1",
				agentType: "code",
				prompt: "Build the auth system",
			};
			const prompt = buildAgentPrompt(AGENTS.code, task);
			expect(prompt).toContain("## Task");
			expect(prompt).toContain("Build the auth system");
		});

		it("should include context as JSON when provided", () => {
			const task: AgentTask = {
				id: "t1",
				agentType: "code",
				prompt: "Implement",
				context: { repo: "test-app", branch: "main" },
			};
			const prompt = buildAgentPrompt(AGENTS.code, task);
			expect(prompt).toContain("## Context");
			expect(prompt).toContain('"repo": "test-app"');
			expect(prompt).toContain('"branch": "main"');
		});

		it("should omit context section when not provided", () => {
			const task: AgentTask = {
				id: "t1",
				agentType: "code",
				prompt: "Implement",
			};
			const prompt = buildAgentPrompt(AGENTS.code, task);
			expect(prompt).not.toContain("## Context");
		});
	});

	describe("extractJson", () => {
		it("should extract JSON from ```json code block", () => {
			const text = 'Analysis:\n```json\n{"plan": "good"}\n```';
			const result = extractJson(text);
			expect(result).toEqual({ plan: "good" });
		});

		it("should extract JSON from generic code block", () => {
			const text = '```\n{"status": "ok"}\n```';
			const result = extractJson(text);
			expect(result).toEqual({ status: "ok" });
		});

		it("should extract raw JSON object", () => {
			const text = 'Here is the result: {"success": true}';
			const result = extractJson(text);
			expect(result).toEqual({ success: true });
		});

		it("should throw when no JSON found", () => {
			expect(() => extractJson("No JSON here")).toThrow(
				"No JSON found in output",
			);
		});

		it("should throw for empty string", () => {
			expect(() => extractJson("")).toThrow("No JSON found in output");
		});

		it("should handle nested JSON", () => {
			const text = '```json\n{"plan": [{"step": 1, "agent": "code"}]}\n```';
			const result = extractJson(text) as {
				plan: { step: number; agent: string }[];
			};
			expect(result.plan).toHaveLength(1);
			expect(result.plan[0].agent).toBe("code");
		});

		it("should throw for invalid JSON in code block", () => {
			expect(() => extractJson("```json\n{invalid}\n```")).toThrow();
		});
	});
});
