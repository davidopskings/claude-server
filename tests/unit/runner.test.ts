/**
 * Unit tests for runner.ts pure logic functions
 * Tests extractSummary, extractJsonFromResponse, buildFeatureContext,
 * buildIterationPrompt, buildPrdIterationPrompt, findNewlyCompletedStories
 */

import { describe, expect, it } from "bun:test";
import type { Prd, PrdStory } from "../../src/db/types.js";

// ===== Replicated pure functions from src/runner.ts =====

function extractSummary(output: string): string {
	const summaryMatch = output.match(
		/##\s*Summary\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*|$)/i,
	);
	if (summaryMatch) {
		return summaryMatch[1].trim().slice(0, 2000);
	}
	const lines = output.split("\n").filter((l) => l.trim());
	return lines.slice(-10).join("\n").slice(0, 1000);
}

function extractJsonFromResponse(text: string): string {
	const jsonStr = text.trim();

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

function buildIterationPrompt(
	basePrompt: string,
	iteration: number,
	maxIterations: number,
	completionPromise: string,
	progressContent: string,
): string {
	return `## Ralph Loop Context
- Iteration: ${iteration} of ${maxIterations}
- To signal completion, output: ${completionPromise}

## Previous Progress
${progressContent || "No previous progress - this is the first iteration."}

## Your Task
${basePrompt}

## Instructions
1. Review the progress above from previous iterations
2. Continue working on the task
3. At the end of your work, include a "## Summary" section describing:
   - What you accomplished this iteration
   - What remains to be done (if anything)
4. If the task is fully complete, output "${completionPromise}" after your summary
5. If feedback commands failed in previous iteration, prioritize fixing those issues
6. If you discover important patterns about this codebase (testing conventions, architecture decisions, common pitfalls, useful commands), add them to AGENTS.md in the repo root. Create it if it doesn't exist.
7. Update the "## Codebase Patterns" section in .ralph-progress.md with any patterns you discover during this iteration - these will help future iterations work more efficiently.
`;
}

function buildPrdIterationPrompt(
	basePrompt: string,
	prd: Prd,
	iteration: number,
	maxIterations: number,
	branchName: string,
): string {
	return `# Ralph Agent Instructions

You are an autonomous coding agent working on a software project.

## Context
- Iteration: ${iteration} of ${maxIterations}
- PRD: "${prd.title}"
- Branch: ${branchName}

## Your Task
${basePrompt}

## Workflow
1. Read the PRD at \`prd.json\` in the repo root
2. Read the progress log at \`progress.txt\` (check Codebase Patterns section first)
3. Check you're on the correct branch (${branchName}). If not, check it out.
4. **Install dependencies if needed** (check for node_modules, vendor, etc. - run npm/bun/pip install if missing)
5. Pick the **highest priority** user story where \`passes: false\`
6. Implement that single user story
7. Run quality checks (typecheck, lint, test - use whatever your project requires)
8. Update AGENTS.md files if you discover reusable patterns
9. If checks pass, commit ALL changes with message: \`feat: [Story ID] - [Story Title]\`
10. Update prd.json to set \`passes: true\` for the completed story
11. Append your progress to \`progress.txt\`

## Progress Report Format
APPEND to progress.txt (never replace, always append):
\`\`\`
## [Date/Time] - Story #X
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
---
\`\`\`

The learnings section is critical - it helps future iterations avoid repeating mistakes.

## Consolidate Patterns
If you discover a **reusable pattern**, add it to the \`## Codebase Patterns\` section at the TOP of progress.txt:
\`\`\`
## Codebase Patterns
- Example: Use \`sql<number>\` template for aggregations
- Example: Always use \`IF NOT EXISTS\` for migrations
\`\`\`

## Update AGENTS.md Files
Before committing, check if edited directories have learnings worth preserving in nearby AGENTS.md files.
Only add genuinely reusable knowledge that would help future work in that directory.

## Quality Requirements
- ALL commits must pass your project's quality checks (typecheck, lint, test)
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow existing code patterns

## If Quality Checks Fail
If typecheck, lint, or tests fail:
1. **Fix the issues** - don't just skip them
2. Re-run the checks until they pass
3. Only then commit and update prd.json
4. If you cannot fix the issue after multiple attempts, document it in progress.txt and move on (do NOT mark the story as passing)

## Stop Condition
After completing a user story, check if ALL stories have \`passes: true\`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with \`passes: false\`, end your response normally (another iteration will pick up the next story).

## CRITICAL: One Story Per Iteration
**You MUST only work on ONE story per iteration. This is non-negotiable.**

After completing ONE story:
1. Commit your changes
2. Update prd.json to mark that ONE story as \`passes: true\`
3. Update progress.txt
4. Check if ALL stories are now complete
5. If all complete: output \`<promise>COMPLETE</promise>\`
6. If not all complete: **STOP IMMEDIATELY** - do NOT continue to the next story

The orchestrator will start a new iteration for the next story. Do NOT try to be efficient by doing multiple stories - this breaks the tracking system.

## Other Guidelines
- Commit frequently
- Keep CI green
- Read the Codebase Patterns section in progress.txt before starting
`;
}

function findNewlyCompletedStories(
	previouslyCompleted: number[],
	currentStories: PrdStory[],
): PrdStory[] {
	return currentStories.filter(
		(story) => story.passes && !previouslyCompleted.includes(story.id),
	);
}

// ===== Tests =====

describe("Runner Pure Logic", () => {
	describe("extractSummary", () => {
		it("should extract summary from ## Summary section", () => {
			const output = `Some work done here.

## Summary
Fixed the login bug and added tests.
Everything is working now.

## Next Steps
- Deploy to staging`;
			const summary = extractSummary(output);
			expect(summary).toBe(
				"Fixed the login bug and added tests.\nEverything is working now.",
			);
		});

		it("should handle case-insensitive Summary heading", () => {
			const output = "## summary\nDid some work.";
			const summary = extractSummary(output);
			expect(summary).toBe("Did some work.");
		});

		it("should stop at next heading", () => {
			const output = "## Summary\nFirst section.\n## Details\nMore info.";
			const summary = extractSummary(output);
			expect(summary).toBe("First section.");
		});

		it("should stop at --- separator", () => {
			const output = "## Summary\nDone with feature.\n---\nSome other stuff.";
			const summary = extractSummary(output);
			expect(summary).toBe("Done with feature.");
		});

		it("should stop at bold text on new line", () => {
			const output = "## Summary\nCompleted task.\n**Note**: Something.";
			const summary = extractSummary(output);
			expect(summary).toBe("Completed task.");
		});

		it("should truncate summary to 2000 chars", () => {
			const longContent = "A".repeat(3000);
			const output = `## Summary\n${longContent}`;
			const summary = extractSummary(output);
			expect(summary.length).toBeLessThanOrEqual(2000);
		});

		it("should fall back to last 10 lines when no Summary section", () => {
			const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
			const output = lines.join("\n");
			const summary = extractSummary(output);
			const resultLines = summary.split("\n");
			expect(resultLines.length).toBe(10);
			expect(resultLines[0]).toBe("Line 11");
			expect(resultLines[9]).toBe("Line 20");
		});

		it("should filter empty lines in fallback mode", () => {
			const output = "Line 1\n\n\nLine 2\n\nLine 3";
			const summary = extractSummary(output);
			expect(summary).toBe("Line 1\nLine 2\nLine 3");
		});

		it("should truncate fallback to 1000 chars", () => {
			const longLine = "B".repeat(1500);
			const output = longLine;
			const summary = extractSummary(output);
			expect(summary.length).toBeLessThanOrEqual(1000);
		});

		it("should handle empty output", () => {
			const summary = extractSummary("");
			expect(summary).toBe("");
		});

		it("should handle output with only whitespace lines", () => {
			const output = "   \n  \n   \n";
			const summary = extractSummary(output);
			expect(summary).toBe("");
		});
	});

	describe("extractJsonFromResponse", () => {
		it("should extract JSON from ```json code block", () => {
			const text = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
			const result = extractJsonFromResponse(text);
			expect(result).toBe('{"key": "value"}');
		});

		it("should extract JSON from generic code block", () => {
			const text = 'Here:\n```\n{"name": "test"}\n```';
			const result = extractJsonFromResponse(text);
			expect(result).toBe('{"name": "test"}');
		});

		it("should extract raw JSON object", () => {
			const text = 'The result is {"status": "ok"} in the response';
			const result = extractJsonFromResponse(text);
			expect(result).toBe('{"status": "ok"}');
		});

		it("should extract raw JSON array", () => {
			const text = "Results: [1, 2, 3]";
			const result = extractJsonFromResponse(text);
			expect(result).toBe("[1, 2, 3]");
		});

		it("should prefer json code block over raw JSON", () => {
			const text =
				'{"outer": true}\n```json\n{"inner": true}\n```\n{"after": true}';
			const result = extractJsonFromResponse(text);
			expect(result).toBe('{"inner": true}');
		});

		it("should handle text with no JSON", () => {
			const text = "Just some plain text here";
			const result = extractJsonFromResponse(text);
			expect(result).toBe("Just some plain text here");
		});

		it("should trim whitespace", () => {
			const text = '  \n  {"key": "value"}  \n  ';
			const result = extractJsonFromResponse(text);
			expect(result).toBe('{"key": "value"}');
		});

		it("should handle nested JSON objects", () => {
			const text = '```json\n{"a": {"b": "c"}}\n```';
			const result = extractJsonFromResponse(text);
			const parsed = JSON.parse(result);
			expect(parsed.a.b).toBe("c");
		});

		it("should handle multiline JSON in code block", () => {
			const text = '```json\n{\n  "key": "value",\n  "num": 42\n}\n```';
			const result = extractJsonFromResponse(text);
			const parsed = JSON.parse(result);
			expect(parsed.key).toBe("value");
			expect(parsed.num).toBe(42);
		});
	});

	describe("buildFeatureContext", () => {
		it("should include title", () => {
			const context = buildFeatureContext({ title: "Add dark mode" });
			expect(context).toBe("Title: Add dark mode");
		});

		it("should include client name", () => {
			const context = buildFeatureContext({
				title: "Feature",
				client: { name: "Acme Corp" },
			});
			expect(context).toContain("Client: Acme Corp");
		});

		it("should include functionality notes", () => {
			const context = buildFeatureContext({
				title: "Feature",
				functionality_notes: "Must support offline mode",
			});
			expect(context).toContain("Functionality Notes:");
			expect(context).toContain("Must support offline mode");
		});

		it("should include client context", () => {
			const context = buildFeatureContext({
				title: "Feature",
				client_context: "Next.js app with Supabase",
			});
			expect(context).toContain("Client Context:");
			expect(context).toContain("Next.js app with Supabase");
		});

		it("should skip null client", () => {
			const context = buildFeatureContext({
				title: "Feature",
				client: null,
			});
			expect(context).not.toContain("Client:");
		});

		it("should include all fields when present", () => {
			const context = buildFeatureContext({
				title: "Dark Mode",
				client: { name: "Acme" },
				functionality_notes: "Toggle in settings",
				client_context: "React app",
			});
			expect(context).toContain("Title: Dark Mode");
			expect(context).toContain("Client: Acme");
			expect(context).toContain("Toggle in settings");
			expect(context).toContain("React app");
		});

		it("should handle empty optional fields", () => {
			const context = buildFeatureContext({
				title: "Minimal",
				client: null,
				functionality_notes: null,
				client_context: null,
			});
			expect(context).toBe("Title: Minimal");
		});
	});

	describe("buildIterationPrompt", () => {
		it("should include iteration count", () => {
			const prompt = buildIterationPrompt("Fix the bug", 3, 10, "<DONE>", "");
			expect(prompt).toContain("Iteration: 3 of 10");
		});

		it("should include completion promise token", () => {
			const prompt = buildIterationPrompt(
				"Fix the bug",
				1,
				5,
				"<promise>COMPLETE</promise>",
				"",
			);
			expect(prompt).toContain("<promise>COMPLETE</promise>");
		});

		it("should include base prompt in Your Task section", () => {
			const prompt = buildIterationPrompt(
				"Implement auth system",
				1,
				5,
				"<DONE>",
				"",
			);
			expect(prompt).toContain("## Your Task");
			expect(prompt).toContain("Implement auth system");
		});

		it("should show no progress message for first iteration", () => {
			const prompt = buildIterationPrompt("Task", 1, 5, "<DONE>", "");
			expect(prompt).toContain(
				"No previous progress - this is the first iteration.",
			);
		});

		it("should include progress content when available", () => {
			const progress = "## Iteration 1\nFixed the login form.";
			const prompt = buildIterationPrompt("Task", 2, 5, "<DONE>", progress);
			expect(prompt).toContain("Fixed the login form.");
			expect(prompt).not.toContain("No previous progress");
		});

		it("should include all 7 instruction points", () => {
			const prompt = buildIterationPrompt("Task", 1, 5, "<DONE>", "");
			expect(prompt).toContain("1. Review the progress");
			expect(prompt).toContain("2. Continue working");
			expect(prompt).toContain("3. At the end of your work");
			expect(prompt).toContain("4. If the task is fully complete");
			expect(prompt).toContain("5. If feedback commands failed");
			expect(prompt).toContain("6. If you discover important patterns");
			expect(prompt).toContain("7. Update the");
		});
	});

	describe("buildPrdIterationPrompt", () => {
		const testPrd: Prd = {
			title: "User Dashboard",
			description: "Build user dashboard",
			stories: [
				{
					id: 1,
					title: "Show stats",
					description: "Display basic stats",
					passes: false,
				},
				{
					id: 2,
					title: "Add charts",
					description: "Chart visualization",
					passes: false,
				},
			],
		};

		it("should include PRD title", () => {
			const prompt = buildPrdIterationPrompt(
				"Implement features",
				testPrd,
				1,
				10,
				"feat/dashboard",
			);
			expect(prompt).toContain('PRD: "User Dashboard"');
		});

		it("should include iteration context", () => {
			const prompt = buildPrdIterationPrompt(
				"Task",
				testPrd,
				3,
				10,
				"feat/test",
			);
			expect(prompt).toContain("Iteration: 3 of 10");
		});

		it("should include branch name", () => {
			const prompt = buildPrdIterationPrompt(
				"Task",
				testPrd,
				1,
				5,
				"feat/my-feature",
			);
			expect(prompt).toContain("Branch: feat/my-feature");
		});

		it("should include base prompt in Your Task section", () => {
			const prompt = buildPrdIterationPrompt(
				"Build the dashboard",
				testPrd,
				1,
				5,
				"feat/dash",
			);
			expect(prompt).toContain("## Your Task");
			expect(prompt).toContain("Build the dashboard");
		});

		it("should include workflow steps", () => {
			const prompt = buildPrdIterationPrompt(
				"Task",
				testPrd,
				1,
				5,
				"feat/test",
			);
			expect(prompt).toContain("Read the PRD at `prd.json`");
			expect(prompt).toContain("Read the progress log");
			expect(prompt).toContain("Pick the **highest priority** user story");
		});

		it("should include one-story-per-iteration rule", () => {
			const prompt = buildPrdIterationPrompt(
				"Task",
				testPrd,
				1,
				5,
				"feat/test",
			);
			expect(prompt).toContain("CRITICAL: One Story Per Iteration");
			expect(prompt).toContain("MUST only work on ONE story per iteration");
		});

		it("should include completion signal", () => {
			const prompt = buildPrdIterationPrompt(
				"Task",
				testPrd,
				1,
				5,
				"feat/test",
			);
			expect(prompt).toContain("<promise>COMPLETE</promise>");
		});

		it("should include quality requirements", () => {
			const prompt = buildPrdIterationPrompt(
				"Task",
				testPrd,
				1,
				5,
				"feat/test",
			);
			expect(prompt).toContain("Quality Requirements");
			expect(prompt).toContain("Do NOT commit broken code");
		});
	});

	describe("findNewlyCompletedStories", () => {
		const stories: PrdStory[] = [
			{ id: 1, title: "Story 1", passes: true },
			{ id: 2, title: "Story 2", passes: true },
			{ id: 3, title: "Story 3", passes: false },
			{ id: 4, title: "Story 4", passes: true },
		];

		it("should find stories completed since last check", () => {
			const previouslyCompleted = [1];
			const newlyCompleted = findNewlyCompletedStories(
				previouslyCompleted,
				stories,
			);
			expect(newlyCompleted).toHaveLength(2);
			expect(newlyCompleted.map((s) => s.id)).toEqual([2, 4]);
		});

		it("should return empty when no new completions", () => {
			const previouslyCompleted = [1, 2, 4];
			const newlyCompleted = findNewlyCompletedStories(
				previouslyCompleted,
				stories,
			);
			expect(newlyCompleted).toHaveLength(0);
		});

		it("should return all passing stories when none previously completed", () => {
			const newlyCompleted = findNewlyCompletedStories([], stories);
			expect(newlyCompleted).toHaveLength(3);
		});

		it("should not include stories that are still failing", () => {
			const newlyCompleted = findNewlyCompletedStories([], stories);
			const ids = newlyCompleted.map((s) => s.id);
			expect(ids).not.toContain(3);
		});

		it("should handle empty stories array", () => {
			const newlyCompleted = findNewlyCompletedStories([1, 2], []);
			expect(newlyCompleted).toHaveLength(0);
		});
	});
});
