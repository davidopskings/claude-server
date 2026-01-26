/**
 * Mock Git operations for testing
 * Simulates git commands without touching the filesystem
 */

import type { AgentJob, CodeRepository } from "../../src/db/types.js";

// Track git operations for assertions
let operations: Array<{
	operation: string;
	args: Record<string, unknown>;
	timestamp: Date;
}> = [];

// Simulated state
let worktrees: Map<string, { repoUrl: string; branch: string; path: string }> =
	new Map();
let bareRepos: Set<string> = new Set();

export function resetMockGit(): void {
	operations = [];
	worktrees = new Map();
	bareRepos = new Set();
}

export function getOperations(): typeof operations {
	return operations;
}

export function getOperationCount(): number {
	return operations.length;
}

export function getWorktrees(): Map<
	string,
	{ repoUrl: string; branch: string; path: string }
> {
	return worktrees;
}

// Mock implementations of git functions

export async function ensureBareRepo(repo: CodeRepository): Promise<string> {
	operations.push({
		operation: "ensureBareRepo",
		args: { repoId: repo.id, repoName: repo.repo_name },
		timestamp: new Date(),
	});

	const barePath = `/tmp/repos/${repo.repo_name}.git`;
	bareRepos.add(barePath);

	return barePath;
}

export async function fetchOrigin(repo: CodeRepository): Promise<void> {
	operations.push({
		operation: "fetchOrigin",
		args: { repoId: repo.id, repoName: repo.repo_name },
		timestamp: new Date(),
	});
}

export async function createWorktree(
	repo: CodeRepository,
	job: AgentJob,
): Promise<string> {
	operations.push({
		operation: "createWorktree",
		args: { repoId: repo.id, jobId: job.id, branch: job.branch_name },
		timestamp: new Date(),
	});

	const worktreePath = `/tmp/worktrees/${repo.repo_name}/${job.id}`;
	worktrees.set(worktreePath, {
		repoUrl: `/tmp/repos/${repo.repo_name}.git`,
		branch: job.branch_name,
		path: worktreePath,
	});

	return worktreePath;
}

export async function cleanupWorktree(
	barePath: string,
	worktreePath: string,
): Promise<void> {
	operations.push({
		operation: "cleanupWorktree",
		args: { barePath, worktreePath },
		timestamp: new Date(),
	});

	worktrees.delete(worktreePath);
}

export async function commitAndPush(
	worktreePath: string,
	message: string,
): Promise<{ sha: string; pushed: boolean }> {
	operations.push({
		operation: "commitAndPush",
		args: { worktreePath, message },
		timestamp: new Date(),
	});

	return {
		sha: `mock-sha-${Date.now().toString(16)}`,
		pushed: true,
	};
}

export async function createPullRequest(
	worktreePath: string,
	title: string,
	body: string,
	baseBranch: string,
): Promise<{ number: number; url: string }> {
	operations.push({
		operation: "createPullRequest",
		args: { worktreePath, title, body, baseBranch },
		timestamp: new Date(),
	});

	const prNumber = Math.floor(Math.random() * 1000) + 1;
	return {
		number: prNumber,
		url: `https://github.com/test-owner/test-repo/pull/${prNumber}`,
	};
}

export async function getCurrentBranch(worktreePath: string): Promise<string> {
	operations.push({
		operation: "getCurrentBranch",
		args: { worktreePath },
		timestamp: new Date(),
	});

	const worktree = worktrees.get(worktreePath);
	return worktree?.branch || "main";
}

export async function hasUncommittedChanges(
	worktreePath: string,
): Promise<boolean> {
	operations.push({
		operation: "hasUncommittedChanges",
		args: { worktreePath },
		timestamp: new Date(),
	});

	return false;
}

export async function getLatestCommitSha(
	worktreePath: string,
): Promise<string> {
	operations.push({
		operation: "getLatestCommitSha",
		args: { worktreePath },
		timestamp: new Date(),
	});

	return `mock-sha-${Date.now().toString(16)}`;
}

// Check git authentication (mock)
export async function checkGitAuth(): Promise<{
	authenticated: boolean;
	user: string | null;
}> {
	operations.push({
		operation: "checkGitAuth",
		args: {},
		timestamp: new Date(),
	});

	return {
		authenticated: true,
		user: "test-user",
	};
}

// Helper to verify specific operations occurred
export function hasOperation(
	operation: string,
	argsMatcher?: (args: Record<string, unknown>) => boolean,
): boolean {
	return operations.some(
		(op) =>
			op.operation === operation && (!argsMatcher || argsMatcher(op.args)),
	);
}

// Helper to get operations of a specific type
export function getOperationsOfType(
	operation: string,
): Array<{ args: Record<string, unknown>; timestamp: Date }> {
	return operations
		.filter((op) => op.operation === operation)
		.map((op) => ({ args: op.args, timestamp: op.timestamp }));
}
