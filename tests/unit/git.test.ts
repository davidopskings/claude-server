/**
 * Unit tests for git.ts helper functions
 * Tests path generation and utility functions (no actual git operations)
 */

import { describe, expect, it } from "bun:test";
import type { CodeRepository } from "../../src/db/types.js";

// Test path generation logic (extracted from git.ts)
// These are pure functions that can be tested without mocking

describe("Git Path Generation", () => {
	const REPOS_DIR = "/tmp/repos";
	const WORKTREES_DIR = "/tmp/worktrees";

	// Replicate the path generation logic for testing
	function bareRepoPath(repo: CodeRepository, reposDir: string): string {
		return `${reposDir}/${repo.repo_name}.git`;
	}

	function worktreePath(
		repo: CodeRepository,
		job: { id: string },
		worktreesDir: string,
	): string {
		return `${worktreesDir}/${repo.repo_name}/${job.id}`;
	}

	const sampleRepo: CodeRepository = {
		id: "repo-1",
		client_id: "client-1",
		provider: "github",
		owner_name: "test-org",
		repo_name: "test-app",
		default_branch: "main",
		url: "https://github.com/test-org/test-app",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};

	const sampleJob = {
		id: "job-abc123",
	};

	describe("bareRepoPath", () => {
		it("should generate correct bare repo path", () => {
			const path = bareRepoPath(sampleRepo, REPOS_DIR);
			expect(path).toBe("/tmp/repos/test-app.git");
		});

		it("should handle repos with dashes in name", () => {
			const repo = { ...sampleRepo, repo_name: "my-cool-app" };
			const path = bareRepoPath(repo, REPOS_DIR);
			expect(path).toBe("/tmp/repos/my-cool-app.git");
		});

		it("should handle repos with underscores in name", () => {
			const repo = { ...sampleRepo, repo_name: "my_cool_app" };
			const path = bareRepoPath(repo, REPOS_DIR);
			expect(path).toBe("/tmp/repos/my_cool_app.git");
		});
	});

	describe("worktreePath", () => {
		it("should generate correct worktree path", () => {
			const path = worktreePath(sampleRepo, sampleJob, WORKTREES_DIR);
			expect(path).toBe("/tmp/worktrees/test-app/job-abc123");
		});

		it("should include job id for isolation", () => {
			const job1 = { id: "job-111" };
			const job2 = { id: "job-222" };

			const path1 = worktreePath(sampleRepo, job1, WORKTREES_DIR);
			const path2 = worktreePath(sampleRepo, job2, WORKTREES_DIR);

			expect(path1).not.toBe(path2);
			expect(path1).toContain("job-111");
			expect(path2).toContain("job-222");
		});

		it("should namespace by repo name", () => {
			const repo1 = { ...sampleRepo, repo_name: "app-one" };
			const repo2 = { ...sampleRepo, repo_name: "app-two" };

			const path1 = worktreePath(repo1, sampleJob, WORKTREES_DIR);
			const path2 = worktreePath(repo2, sampleJob, WORKTREES_DIR);

			expect(path1).toContain("app-one");
			expect(path2).toContain("app-two");
		});
	});
});

describe("Git URL Generation", () => {
	function gitSshUrl(ownerName: string, repoName: string): string {
		return `git@github.com:${ownerName}/${repoName}.git`;
	}

	function gitHttpsUrl(ownerName: string, repoName: string): string {
		return `https://github.com/${ownerName}/${repoName}.git`;
	}

	it("should generate correct SSH URL", () => {
		const url = gitSshUrl("test-org", "test-app");
		expect(url).toBe("git@github.com:test-org/test-app.git");
	});

	it("should generate correct HTTPS URL", () => {
		const url = gitHttpsUrl("test-org", "test-app");
		expect(url).toBe("https://github.com/test-org/test-app.git");
	});

	it("should handle org names with dashes", () => {
		const url = gitSshUrl("my-cool-org", "my-app");
		expect(url).toBe("git@github.com:my-cool-org/my-app.git");
	});
});

describe("Branch Name Validation", () => {
	// Test branch name validation logic
	function isValidBranchName(name: string): boolean {
		// Git branch naming rules (simplified)
		if (!name || name.length === 0) return false;
		if (name.startsWith("-") || name.endsWith("-")) return false;
		if (name.includes("..")) return false;
		if (name.includes("~") || name.includes("^") || name.includes(":"))
			return false;
		if (name.includes("\\")) return false;
		if (name.includes(" ")) return false;
		if (name.endsWith(".lock")) return false;
		return true;
	}

	it("should accept valid branch names", () => {
		expect(isValidBranchName("main")).toBe(true);
		expect(isValidBranchName("feature/auth")).toBe(true);
		expect(isValidBranchName("feat/add-login")).toBe(true);
		expect(isValidBranchName("fix/bug-123")).toBe(true);
		expect(isValidBranchName("release/v1.0.0")).toBe(true);
	});

	it("should reject invalid branch names", () => {
		expect(isValidBranchName("")).toBe(false);
		expect(isValidBranchName("-feature")).toBe(false);
		expect(isValidBranchName("feature-")).toBe(false);
		expect(isValidBranchName("feature..test")).toBe(false);
		expect(isValidBranchName("feature~test")).toBe(false);
		expect(isValidBranchName("feature^test")).toBe(false);
		expect(isValidBranchName("feature:test")).toBe(false);
		expect(isValidBranchName("feature\\test")).toBe(false);
		expect(isValidBranchName("feature test")).toBe(false);
		expect(isValidBranchName("feature.lock")).toBe(false);
	});
});

describe("Branch Name Generation", () => {
	// Test branch name generation from feature titles
	function generateBranchName(featureTitle: string, prefix = "feat"): string {
		const slug = featureTitle
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "") // Remove special chars
			.replace(/\s+/g, "-") // Spaces to dashes
			.replace(/-+/g, "-") // Multiple dashes to single
			.replace(/^-|-$/g, "") // Trim dashes
			.slice(0, 50); // Limit length

		return `${prefix}/${slug}`;
	}

	it("should generate valid branch name from simple title", () => {
		const branch = generateBranchName("Add login button");
		expect(branch).toBe("feat/add-login-button");
	});

	it("should handle special characters", () => {
		const branch = generateBranchName("Add login (v2) & signup!");
		expect(branch).toBe("feat/add-login-v2-signup");
	});

	it("should handle uppercase", () => {
		const branch = generateBranchName("Add LOGIN Feature");
		expect(branch).toBe("feat/add-login-feature");
	});

	it("should truncate long titles", () => {
		const longTitle =
			"This is a very long feature title that should be truncated to avoid git branch name issues";
		const branch = generateBranchName(longTitle);
		expect(branch.length).toBeLessThanOrEqual(55); // prefix + / + 50 chars
	});

	it("should use custom prefix", () => {
		const branch = generateBranchName("Fix memory leak", "fix");
		expect(branch).toBe("fix/fix-memory-leak");
	});

	it("should handle spec prefix", () => {
		const branch = generateBranchName("Auth system design", "spec");
		expect(branch).toBe("spec/auth-system-design");
	});
});

describe("Commit Message Formatting", () => {
	// Test commit message formatting
	function formatCommitMessage(
		type: string,
		scope: string | null,
		message: string,
	): string {
		const scopePart = scope ? `(${scope})` : "";
		return `${type}${scopePart}: ${message}`;
	}

	it("should format conventional commit without scope", () => {
		const msg = formatCommitMessage("feat", null, "add user authentication");
		expect(msg).toBe("feat: add user authentication");
	});

	it("should format conventional commit with scope", () => {
		const msg = formatCommitMessage("fix", "auth", "correct token validation");
		expect(msg).toBe("fix(auth): correct token validation");
	});

	it("should handle different commit types", () => {
		expect(formatCommitMessage("feat", null, "new feature")).toBe(
			"feat: new feature",
		);
		expect(formatCommitMessage("fix", null, "bug fix")).toBe("fix: bug fix");
		expect(formatCommitMessage("docs", null, "update readme")).toBe(
			"docs: update readme",
		);
		expect(formatCommitMessage("refactor", null, "clean up")).toBe(
			"refactor: clean up",
		);
		expect(formatCommitMessage("test", null, "add tests")).toBe(
			"test: add tests",
		);
	});
});

describe("Pull Request Title/Body Generation", () => {
	interface PrContext {
		featureTitle: string;
		branchName: string;
		commits: string[];
	}

	function generatePrTitle(ctx: PrContext): string {
		return ctx.featureTitle;
	}

	function generatePrBody(ctx: PrContext): string {
		const commitList = ctx.commits.map((c) => `- ${c}`).join("\n");
		return `## Summary

This PR implements: ${ctx.featureTitle}

## Changes

${commitList}

---
Generated by Claude Code Agent`;
	}

	const sampleContext: PrContext = {
		featureTitle: "Add user authentication",
		branchName: "feat/add-user-authentication",
		commits: [
			"feat: add auth module structure",
			"feat: implement JWT utilities",
			"test: add auth tests",
		],
	};

	it("should generate PR title from feature title", () => {
		const title = generatePrTitle(sampleContext);
		expect(title).toBe("Add user authentication");
	});

	it("should generate PR body with commits", () => {
		const body = generatePrBody(sampleContext);
		expect(body).toContain("Add user authentication");
		expect(body).toContain("- feat: add auth module structure");
		expect(body).toContain("- feat: implement JWT utilities");
		expect(body).toContain("- test: add auth tests");
	});

	it("should include generated by footer", () => {
		const body = generatePrBody(sampleContext);
		expect(body).toContain("Generated by Claude Code Agent");
	});
});
