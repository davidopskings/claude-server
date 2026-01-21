/**
 * Skill Library
 *
 * Reusable, composable skills for common development patterns.
 * Skills can be triggered automatically based on context or manually invoked.
 */

import { exec } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { addJobMessage } from "../db/index.js";

const execAsync = promisify(exec);

export interface SkillStep {
	type: "run" | "create" | "edit" | "validate";
	target?: string;
	command?: string;
	template?: string;
	content?: string;
	validation?: string;
}

export interface Skill {
	name: string;
	description: string;
	triggers?: {
		patterns: string[];
		confidence: "high" | "medium" | "low";
	};
	requires?: string[];
	steps: SkillStep[];
	validation?: string[];
	templates?: Record<string, string>;
}

export interface SkillContext {
	jobId: string;
	cwd: string;
	params: Record<string, string>;
}

export interface SkillResult {
	success: boolean;
	stepsCompleted: number;
	totalSteps: number;
	outputs: string[];
	errors: string[];
}

// Built-in skill library
export const SKILLS: Record<string, Skill> = {
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
			{
				type: "create",
				target: "src/components/{{name}}/{{name}}.tsx",
				template: "react-component",
			},
			{
				type: "create",
				target: "src/components/{{name}}/{{name}}.test.tsx",
				template: "react-component-test",
			},
			{
				type: "create",
				target: "src/components/{{name}}/index.ts",
				template: "component-index",
			},
		],
		templates: {
			"react-component": `import React from 'react';

interface {{name}}Props {
  // Add props here
}

export function {{name}}({ }: {{name}}Props) {
  return (
    <div>
      {/* {{name}} component */}
    </div>
  );
}
`,
			"react-component-test": `import { render, screen } from '@testing-library/react';
import { {{name}} } from './{{name}}';

describe('{{name}}', () => {
  it('renders without crashing', () => {
    render(<{{name}} />);
  });
});
`,
			"component-index": `export { {{name}} } from './{{name}}';
`,
		},
	},

	api_endpoint: {
		name: "Next.js API Endpoint",
		description: "Create a Next.js API route with validation",
		triggers: {
			patterns: ["api", "endpoint", "route", "handler"],
			confidence: "medium",
		},
		steps: [
			{
				type: "create",
				target: "src/app/api/{{path}}/route.ts",
				template: "api-route",
			},
			{
				type: "create",
				target: "src/app/api/{{path}}/route.test.ts",
				template: "api-route-test",
			},
		],
		validation: [
			"Route handler exports GET/POST/etc",
			"Input validation with zod",
			"Error handling present",
		],
		templates: {
			"api-route": `import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  // Define input schema
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = schema.parse(body);

    // Implement handler logic

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
`,
			"api-route-test": `import { POST } from './route';

describe('{{path}} API', () => {
  it('returns 400 for invalid input', async () => {
    const request = new Request('http://localhost/api/{{path}}', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });
});
`,
		},
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
				template: "server-action",
			},
		],
		templates: {
			"server-action": `"use server";

import { actionClient } from "@/lib/safe-action";
import { z } from "zod";

const schema = z.object({
  // Define input schema
});

export const {{name}} = actionClient
  .schema(schema)
  .action(async ({ parsedInput }) => {
    try {
      // Implement action logic

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
`,
		},
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
			{ type: "create", target: "{{path}}.test.ts", template: "test-suite" },
			{ type: "run", command: "npm test -- --watch=false {{path}}.test.ts" },
		],
		templates: {
			"test-suite": `import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('{{name}}', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it('should work correctly', () => {
    // Add test cases
    expect(true).toBe(true);
  });
});
`,
		},
	},

	auth_protection: {
		name: "Auth Protection",
		description: "Add authentication protection to a route",
		triggers: {
			patterns: ["auth", "protected", "login", "session"],
			confidence: "medium",
		},
		requires: ["auth_middleware_exists"],
		steps: [
			{ type: "edit", target: "{{path}}", content: "Add withAuth wrapper" },
			{ type: "validate", validation: "Route is protected" },
		],
	},

	error_boundary: {
		name: "Error Boundary",
		description: "Add error boundary to a React component",
		triggers: {
			patterns: ["error", "boundary", "catch", "fallback"],
			confidence: "medium",
		},
		steps: [
			{
				type: "create",
				target: "src/components/{{name}}/error.tsx",
				template: "error-boundary",
			},
		],
		templates: {
			"error-boundary": `'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8">
      <h2 className="text-xl font-semibold">Something went wrong!</h2>
      <button
        onClick={() => reset()}
        className="px-4 py-2 bg-primary text-white rounded-md"
      >
        Try again
      </button>
    </div>
  );
}
`,
		},
	},
};

/**
 * Run a skill with given context and parameters
 */
export async function runSkill(
	skillName: string,
	ctx: SkillContext,
): Promise<SkillResult> {
	const skill = SKILLS[skillName];
	if (!skill) {
		return {
			success: false,
			stepsCompleted: 0,
			totalSteps: 0,
			outputs: [],
			errors: [`Unknown skill: ${skillName}`],
		};
	}

	await addJobMessage(ctx.jobId, "system", `Running skill: ${skill.name}`);

	const outputs: string[] = [];
	const errors: string[] = [];
	let stepsCompleted = 0;

	// Check prerequisites
	if (skill.requires) {
		for (const req of skill.requires) {
			const met = await checkRequirement(req, ctx);
			if (!met) {
				errors.push(`Prerequisite not met: ${req}`);
				return {
					success: false,
					stepsCompleted: 0,
					totalSteps: skill.steps.length,
					outputs,
					errors,
				};
			}
		}
	}

	// Execute steps
	for (const step of skill.steps) {
		try {
			const result = await executeStep(step, ctx, skill.templates);
			outputs.push(result);
			stepsCompleted++;
			await addJobMessage(
				ctx.jobId,
				"system",
				`✓ Step ${stepsCompleted}: ${result}`,
			);
		} catch (err) {
			errors.push(
				`Step ${stepsCompleted + 1} failed: ${(err as Error).message}`,
			);
			await addJobMessage(
				ctx.jobId,
				"system",
				`✗ Step ${stepsCompleted + 1} failed: ${(err as Error).message}`,
			);
			break;
		}
	}

	const success = stepsCompleted === skill.steps.length && errors.length === 0;

	await addJobMessage(
		ctx.jobId,
		"system",
		`Skill ${skill.name}: ${success ? "SUCCESS" : "FAILED"} (${stepsCompleted}/${skill.steps.length} steps)`,
	);

	return {
		success,
		stepsCompleted,
		totalSteps: skill.steps.length,
		outputs,
		errors,
	};
}

/**
 * Execute a single skill step
 */
async function executeStep(
	step: SkillStep,
	ctx: SkillContext,
	templates?: Record<string, string>,
): Promise<string> {
	switch (step.type) {
		case "run": {
			if (!step.command) throw new Error("run step requires command");
			const command = interpolate(step.command, ctx.params);
			await execAsync(command, {
				cwd: ctx.cwd,
				timeout: 120000,
			});
			return `Ran: ${command}`;
		}

		case "create": {
			if (!step.target) throw new Error("create step requires target");
			const path = join(ctx.cwd, interpolate(step.target, ctx.params));
			let content = step.content || "";

			if (step.template && templates?.[step.template]) {
				content = interpolate(templates[step.template], ctx.params);
			}

			// Ensure directory exists
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content);
			return `Created: ${path}`;
		}

		case "edit": {
			if (!step.target) throw new Error("edit step requires target");
			const path = join(ctx.cwd, interpolate(step.target, ctx.params));
			if (!existsSync(path)) {
				throw new Error(`File not found: ${path}`);
			}
			// Edit step is a placeholder - actual editing done by Claude
			return `Edit target: ${path}`;
		}

		case "validate": {
			// Validation is a placeholder - actual validation done by LLM
			return `Validation: ${step.validation}`;
		}

		default:
			throw new Error(`Unknown step type: ${step.type}`);
	}
}

/**
 * Check if a requirement is met
 */
async function checkRequirement(
	requirement: string,
	ctx: SkillContext,
): Promise<boolean> {
	switch (requirement) {
		case "auth_middleware_exists":
			return existsSync(join(ctx.cwd, "src/middleware.ts"));

		case "prisma_schema_exists":
			return existsSync(join(ctx.cwd, "prisma/schema.prisma"));

		case "package_json_exists":
			return existsSync(join(ctx.cwd, "package.json"));

		default:
			// Unknown requirement - assume met
			return true;
	}
}

/**
 * Interpolate template strings with parameters
 */
function interpolate(template: string, params: Record<string, string>): string {
	return template.replace(
		/\{\{(\w+)\}\}/g,
		(_, key) => params[key] || `{{${key}}}`,
	);
}

/**
 * Detect which skills might be relevant for a given description
 */
export function detectRelevantSkills(
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

	// Sort by confidence
	return relevant.sort((a, b) => {
		const order = { high: 0, medium: 1, low: 2 };
		return (
			order[a.confidence as keyof typeof order] -
			order[b.confidence as keyof typeof order]
		);
	});
}

/**
 * List all available skills
 */
export function listSkills(): { name: string; description: string }[] {
	return Object.entries(SKILLS).map(([name, skill]) => ({
		name,
		description: skill.description,
	}));
}
