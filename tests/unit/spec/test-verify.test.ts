/**
 * Unit tests for spec/test-verify.ts pure logic functions
 * Tests pattern constants, detectCommand logic, and result aggregation
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated constants from src/spec/test-verify.ts =====

const DEFAULT_TEST_PATTERNS = [
	{ check: "package.json", commands: ["npm test", "npm run test"] },
	{ check: "bun.lockb", commands: ["bun test"] },
	{ check: "yarn.lock", commands: ["yarn test"] },
	{ check: "pnpm-lock.yaml", commands: ["pnpm test"] },
	{ check: "pytest.ini", commands: ["pytest"] },
	{ check: "pyproject.toml", commands: ["pytest", "python -m pytest"] },
	{ check: "Cargo.toml", commands: ["cargo test"] },
	{ check: "go.mod", commands: ["go test ./..."] },
];

const TYPE_CHECK_PATTERNS = [
	{
		check: "tsconfig.json",
		commands: ["npx tsc --noEmit", "bun run check-types"],
	},
	{ check: "pyproject.toml", commands: ["mypy .", "pyright"] },
];

const LINT_PATTERNS = [
	{ check: "biome.json", commands: ["npx biome check ."] },
	{ check: ".eslintrc", commands: ["npx eslint ."] },
	{ check: ".eslintrc.js", commands: ["npx eslint ."] },
	{ check: ".eslintrc.json", commands: ["npx eslint ."] },
	{ check: "pyproject.toml", commands: ["ruff check ."] },
];

// Replicate detectCommand logic (without fs)
function detectCommand(
	existingFiles: string[],
	patterns: { check: string; commands: string[] }[],
): string | null {
	for (const pattern of patterns) {
		if (existingFiles.includes(pattern.check)) {
			return pattern.commands[0];
		}
	}
	return null;
}

// Replicate result aggregation logic
interface TestResult {
	command: string;
	passed: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	duration: number;
}

function aggregateResults(results: TestResult[]): {
	passed: boolean;
	summary: string;
	failedTests: string[];
} {
	const failedTests: string[] = [];

	for (const result of results) {
		if (!result.passed) {
			failedTests.push(result.command);
		}
	}

	const passed = failedTests.length === 0;
	const summary = passed
		? `All ${results.length} checks passed`
		: `${failedTests.length} of ${results.length} checks failed: ${failedTests.join(", ")}`;

	return { passed, summary, failedTests };
}

// Replicate logResult format
function formatLogResult(result: TestResult): string {
	const status = result.passed ? "✓" : "✗";
	const duration = (result.duration / 1000).toFixed(1);
	return `${status} ${result.command} (${duration}s)`;
}

// ===== Tests =====

describe("Test Verify Pure Logic", () => {
	describe("DEFAULT_TEST_PATTERNS", () => {
		it("should have 8 test pattern entries", () => {
			expect(DEFAULT_TEST_PATTERNS).toHaveLength(8);
		});

		it("should have check and commands for each entry", () => {
			for (const pattern of DEFAULT_TEST_PATTERNS) {
				expect(typeof pattern.check).toBe("string");
				expect(Array.isArray(pattern.commands)).toBe(true);
				expect(pattern.commands.length).toBeGreaterThan(0);
			}
		});

		it("should include common package managers", () => {
			const checks = DEFAULT_TEST_PATTERNS.map((p) => p.check);
			expect(checks).toContain("package.json");
			expect(checks).toContain("bun.lockb");
			expect(checks).toContain("yarn.lock");
		});

		it("should include language-specific patterns", () => {
			const checks = DEFAULT_TEST_PATTERNS.map((p) => p.check);
			expect(checks).toContain("Cargo.toml");
			expect(checks).toContain("go.mod");
			expect(checks).toContain("pytest.ini");
		});
	});

	describe("TYPE_CHECK_PATTERNS", () => {
		it("should have 2 type check pattern entries", () => {
			expect(TYPE_CHECK_PATTERNS).toHaveLength(2);
		});

		it("should include TypeScript check", () => {
			const tsPattern = TYPE_CHECK_PATTERNS.find(
				(p) => p.check === "tsconfig.json",
			);
			expect(tsPattern).toBeDefined();
			expect(tsPattern?.commands[0]).toContain("tsc");
		});

		it("should include Python type check", () => {
			const pyPattern = TYPE_CHECK_PATTERNS.find(
				(p) => p.check === "pyproject.toml",
			);
			expect(pyPattern).toBeDefined();
			expect(pyPattern?.commands[0]).toContain("mypy");
		});
	});

	describe("LINT_PATTERNS", () => {
		it("should have 5 lint pattern entries", () => {
			expect(LINT_PATTERNS).toHaveLength(5);
		});

		it("should include biome pattern", () => {
			const biome = LINT_PATTERNS.find((p) => p.check === "biome.json");
			expect(biome).toBeDefined();
			expect(biome?.commands[0]).toContain("biome");
		});

		it("should include multiple eslint config variants", () => {
			const eslintPatterns = LINT_PATTERNS.filter((p) =>
				p.check.startsWith(".eslintrc"),
			);
			expect(eslintPatterns.length).toBe(3);
		});
	});

	describe("detectCommand", () => {
		it("should return first matching command for Node project", () => {
			const existingFiles = ["package.json", "src/index.ts"];
			const cmd = detectCommand(existingFiles, DEFAULT_TEST_PATTERNS);
			expect(cmd).toBe("npm test");
		});

		it("should return bun test for bun project", () => {
			// bun.lockb comes before package.json? No, package.json first
			// But if we only have bun.lockb:
			const cmd = detectCommand(["bun.lockb"], DEFAULT_TEST_PATTERNS);
			expect(cmd).toBe("bun test");
		});

		it("should return cargo test for Rust project", () => {
			const cmd = detectCommand(["Cargo.toml"], DEFAULT_TEST_PATTERNS);
			expect(cmd).toBe("cargo test");
		});

		it("should return null when no pattern matches", () => {
			const cmd = detectCommand(["README.md"], DEFAULT_TEST_PATTERNS);
			expect(cmd).toBeNull();
		});

		it("should return first matching pattern (priority order)", () => {
			// If both package.json and bun.lockb exist, package.json matches first
			const cmd = detectCommand(
				["package.json", "bun.lockb"],
				DEFAULT_TEST_PATTERNS,
			);
			expect(cmd).toBe("npm test");
		});

		it("should detect TypeScript type check", () => {
			const cmd = detectCommand(["tsconfig.json"], TYPE_CHECK_PATTERNS);
			expect(cmd).toBe("npx tsc --noEmit");
		});

		it("should detect biome lint", () => {
			const cmd = detectCommand(["biome.json"], LINT_PATTERNS);
			expect(cmd).toBe("npx biome check .");
		});

		it("should return null for empty file list", () => {
			const cmd = detectCommand([], DEFAULT_TEST_PATTERNS);
			expect(cmd).toBeNull();
		});
	});

	describe("Result aggregation", () => {
		it("should report all passed when no failures", () => {
			const results: TestResult[] = [
				{
					command: "bun test",
					passed: true,
					exitCode: 0,
					stdout: "OK",
					stderr: "",
					duration: 1000,
				},
				{
					command: "bun tsc",
					passed: true,
					exitCode: 0,
					stdout: "OK",
					stderr: "",
					duration: 500,
				},
			];
			const agg = aggregateResults(results);
			expect(agg.passed).toBe(true);
			expect(agg.summary).toBe("All 2 checks passed");
			expect(agg.failedTests).toHaveLength(0);
		});

		it("should report failures with command names", () => {
			const results: TestResult[] = [
				{
					command: "bun test",
					passed: false,
					exitCode: 1,
					stdout: "",
					stderr: "Error",
					duration: 2000,
				},
				{
					command: "bun tsc",
					passed: true,
					exitCode: 0,
					stdout: "OK",
					stderr: "",
					duration: 500,
				},
			];
			const agg = aggregateResults(results);
			expect(agg.passed).toBe(false);
			expect(agg.failedTests).toEqual(["bun test"]);
			expect(agg.summary).toContain("1 of 2 checks failed");
		});

		it("should list all failed commands", () => {
			const results: TestResult[] = [
				{
					command: "test",
					passed: false,
					exitCode: 1,
					stdout: "",
					stderr: "",
					duration: 0,
				},
				{
					command: "lint",
					passed: false,
					exitCode: 1,
					stdout: "",
					stderr: "",
					duration: 0,
				},
				{
					command: "tsc",
					passed: true,
					exitCode: 0,
					stdout: "",
					stderr: "",
					duration: 0,
				},
			];
			const agg = aggregateResults(results);
			expect(agg.failedTests).toEqual(["test", "lint"]);
			expect(agg.summary).toContain("2 of 3 checks failed");
		});

		it("should handle empty results", () => {
			const agg = aggregateResults([]);
			expect(agg.passed).toBe(true);
			expect(agg.summary).toBe("All 0 checks passed");
		});
	});

	describe("formatLogResult", () => {
		it("should format passed result with checkmark", () => {
			const result: TestResult = {
				command: "bun test",
				passed: true,
				exitCode: 0,
				stdout: "",
				stderr: "",
				duration: 1500,
			};
			const formatted = formatLogResult(result);
			expect(formatted).toBe("✓ bun test (1.5s)");
		});

		it("should format failed result with X", () => {
			const result: TestResult = {
				command: "npm test",
				passed: false,
				exitCode: 1,
				stdout: "",
				stderr: "",
				duration: 3200,
			};
			const formatted = formatLogResult(result);
			expect(formatted).toBe("✗ npm test (3.2s)");
		});

		it("should format duration in seconds with 1 decimal", () => {
			const result: TestResult = {
				command: "test",
				passed: true,
				exitCode: 0,
				stdout: "",
				stderr: "",
				duration: 500,
			};
			const formatted = formatLogResult(result);
			expect(formatted).toContain("0.5s");
		});
	});
});
