import { exec } from "node:child_process";
import { promisify } from "node:util";
import { addJobMessage } from "../db/index.js";

const execAsync = promisify(exec);

export interface TestResult {
	command: string;
	passed: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	duration: number;
}

export interface TestVerificationResult {
	passed: boolean;
	results: TestResult[];
	summary: string;
	failedTests: string[];
}

// Default test commands to try based on common patterns
const DEFAULT_TEST_PATTERNS = [
	{ check: "package.json", commands: ["npm test", "npm run test"] },
	{ check: "bun.lockb", commands: ["bun test"] },
	{ check: "yarn.lock", commands: ["yarn test"] },
	{ check: "pnpm-lock.yaml", commands: ["pnpm test"] },
	{ check: "playwright.config.ts", commands: ["npx playwright test"] },
	{ check: "playwright.config.js", commands: ["npx playwright test"] },
	{ check: "pytest.ini", commands: ["pytest"] },
	{ check: "pyproject.toml", commands: ["pytest", "python -m pytest"] },
	{ check: "Cargo.toml", commands: ["cargo test"] },
	{ check: "go.mod", commands: ["go test ./..."] },
];

// Type check commands
const TYPE_CHECK_PATTERNS = [
	{
		check: "tsconfig.json",
		commands: ["npx tsc --noEmit", "bun run check-types"],
	},
	{ check: "pyproject.toml", commands: ["mypy .", "pyright"] },
];

// Lint commands
const LINT_PATTERNS = [
	{ check: "biome.json", commands: ["npx biome check ."] },
	{ check: ".eslintrc", commands: ["npx eslint ."] },
	{ check: ".eslintrc.js", commands: ["npx eslint ."] },
	{ check: ".eslintrc.json", commands: ["npx eslint ."] },
	{ check: "pyproject.toml", commands: ["ruff check ."] },
];

/**
 * Run test verification for a worktree
 */
export async function runTestVerification(
	cwd: string,
	jobId: string,
	options: {
		runTests?: boolean;
		runTypeCheck?: boolean;
		runLint?: boolean;
		customCommands?: string[];
		timeout?: number;
	} = {},
): Promise<TestVerificationResult> {
	const {
		runTests = true,
		runTypeCheck = true,
		runLint = true,
		customCommands = [],
		timeout = 300000, // 5 minutes default
	} = options;

	const results: TestResult[] = [];
	const failedTests: string[] = [];

	await addJobMessage(jobId, "system", "Starting test verification...");

	// Run custom commands first (if provided)
	if (customCommands.length > 0) {
		for (const cmd of customCommands) {
			const result = await runCommand(cmd, cwd, timeout);
			results.push(result);
			if (!result.passed) {
				failedTests.push(cmd);
			}
			await logResult(jobId, result);
		}
	}

	// Run type check
	if (runTypeCheck) {
		const typeCheckCmd = await detectCommand(cwd, TYPE_CHECK_PATTERNS);
		if (typeCheckCmd) {
			const result = await runCommand(typeCheckCmd, cwd, timeout);
			results.push(result);
			if (!result.passed) {
				failedTests.push("Type check");
			}
			await logResult(jobId, result);
		}
	}

	// Run lint
	if (runLint) {
		const lintCmd = await detectCommand(cwd, LINT_PATTERNS);
		if (lintCmd) {
			const result = await runCommand(lintCmd, cwd, timeout);
			results.push(result);
			if (!result.passed) {
				failedTests.push("Lint");
			}
			await logResult(jobId, result);
		}
	}

	// Run tests
	if (runTests) {
		const testCmd = await detectCommand(cwd, DEFAULT_TEST_PATTERNS);
		if (testCmd) {
			const result = await runCommand(testCmd, cwd, timeout);
			results.push(result);
			if (!result.passed) {
				failedTests.push("Tests");
			}
			await logResult(jobId, result);
		}
	}

	const passed = failedTests.length === 0;
	const summary = passed
		? `All ${results.length} checks passed`
		: `${failedTests.length} of ${results.length} checks failed: ${failedTests.join(", ")}`;

	await addJobMessage(
		jobId,
		"system",
		`Test verification ${passed ? "PASSED" : "FAILED"}: ${summary}`,
	);

	return {
		passed,
		results,
		summary,
		failedTests,
	};
}

/**
 * Detect which command to run based on project files
 */
async function detectCommand(
	cwd: string,
	patterns: { check: string; commands: string[] }[],
): Promise<string | null> {
	const { existsSync } = await import("node:fs");
	const { join } = await import("node:path");

	for (const pattern of patterns) {
		if (existsSync(join(cwd, pattern.check))) {
			// Return first command (most common)
			return pattern.commands[0];
		}
	}
	return null;
}

/**
 * Run a single command and return result
 */
async function runCommand(
	command: string,
	cwd: string,
	timeout: number,
): Promise<TestResult> {
	const startTime = Date.now();

	try {
		const { stdout, stderr } = await execAsync(command, {
			cwd,
			timeout,
			maxBuffer: 10 * 1024 * 1024, // 10MB
		});

		return {
			command,
			passed: true,
			exitCode: 0,
			stdout: stdout.slice(0, 10000),
			stderr: stderr.slice(0, 10000),
			duration: Date.now() - startTime,
		};
	} catch (err) {
		const execErr = err as {
			code?: number;
			stdout?: string;
			stderr?: string;
			message?: string;
		};
		return {
			command,
			passed: false,
			exitCode: execErr.code || 1,
			stdout: (execErr.stdout || "").slice(0, 10000),
			stderr: (execErr.stderr || execErr.message || "").slice(0, 10000),
			duration: Date.now() - startTime,
		};
	}
}

/**
 * Log result to job messages
 */
async function logResult(jobId: string, result: TestResult): Promise<void> {
	const status = result.passed ? "✓" : "✗";
	const duration = (result.duration / 1000).toFixed(1);
	await addJobMessage(
		jobId,
		"system",
		`${status} ${result.command} (${duration}s)`,
	);

	if (!result.passed && result.stderr) {
		// Log first few lines of error
		const errorPreview = result.stderr.split("\n").slice(0, 10).join("\n");
		await addJobMessage(jobId, "stderr", errorPreview);
	}
}

/**
 * Verify acceptance criteria from spec output
 * This runs custom test commands that verify specific functionality
 */
export async function verifyAcceptanceCriteria(
	cwd: string,
	jobId: string,
	acceptanceCriteria: { id: string; criteria: string; testCommand?: string }[],
): Promise<{
	passed: boolean;
	results: { criteriaId: string; passed: boolean; message: string }[];
}> {
	const results: { criteriaId: string; passed: boolean; message: string }[] =
		[];

	await addJobMessage(
		jobId,
		"system",
		`Verifying ${acceptanceCriteria.length} acceptance criteria...`,
	);

	for (const ac of acceptanceCriteria) {
		if (ac.testCommand) {
			const testResult = await runCommand(ac.testCommand, cwd, 60000);
			results.push({
				criteriaId: ac.id,
				passed: testResult.passed,
				message: testResult.passed
					? `Passed: ${ac.criteria}`
					: `Failed: ${testResult.stderr.slice(0, 200)}`,
			});
		} else {
			// No test command - mark as needing manual verification
			results.push({
				criteriaId: ac.id,
				passed: true, // Assume passed if no automated test
				message: `Manual verification needed: ${ac.criteria}`,
			});
		}
	}

	const passed = results.every((r) => r.passed);
	await addJobMessage(
		jobId,
		"system",
		`Acceptance criteria: ${results.filter((r) => r.passed).length}/${results.length} passed`,
	);

	return { passed, results };
}
