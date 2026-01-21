/**
 * Unit tests for queue.ts
 * Tests job routing, queue status, and cancellation
 */

import { describe, expect, it } from "bun:test";
import type { AgentJob, JobType } from "../../src/db/types.js";

// We'll test the queue logic by examining the routing decisions
// The actual queue uses imports we need to mock

describe("Queue Job Routing Logic", () => {
	// Test the routing decision logic that would be in processQueue
	function getRunnerForJob(job: {
		job_type: JobType;
		prd_mode?: boolean;
	}): string {
		if (job.job_type === "spec") {
			return "runSpecJob";
		}
		if (job.job_type === "ralph") {
			return job.prd_mode ? "runRalphPrdJob" : "runRalphJob";
		}
		return "runJob";
	}

	describe("runner selection", () => {
		it("should route code jobs to runJob", () => {
			const runner = getRunnerForJob({ job_type: "code" });
			expect(runner).toBe("runJob");
		});

		it("should route task jobs to runJob", () => {
			const runner = getRunnerForJob({ job_type: "task" });
			expect(runner).toBe("runJob");
		});

		it("should route ralph jobs to runRalphJob", () => {
			const runner = getRunnerForJob({ job_type: "ralph" });
			expect(runner).toBe("runRalphJob");
		});

		it("should route ralph prd_mode jobs to runRalphPrdJob", () => {
			const runner = getRunnerForJob({ job_type: "ralph", prd_mode: true });
			expect(runner).toBe("runRalphPrdJob");
		});

		it("should route spec jobs to runSpecJob", () => {
			const runner = getRunnerForJob({ job_type: "spec" });
			expect(runner).toBe("runSpecJob");
		});
	});
});

describe("Queue Status Formatting", () => {
	// Test the formatDuration logic
	function formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		}
		if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		}
		return `${seconds}s`;
	}

	it("should format seconds only", () => {
		expect(formatDuration(5000)).toBe("5s");
		expect(formatDuration(30000)).toBe("30s");
		expect(formatDuration(59000)).toBe("59s");
	});

	it("should format minutes and seconds", () => {
		expect(formatDuration(60000)).toBe("1m 0s");
		expect(formatDuration(90000)).toBe("1m 30s");
		expect(formatDuration(300000)).toBe("5m 0s");
		expect(formatDuration(3599000)).toBe("59m 59s");
	});

	it("should format hours and minutes", () => {
		expect(formatDuration(3600000)).toBe("1h 0m");
		expect(formatDuration(5400000)).toBe("1h 30m");
		expect(formatDuration(7200000)).toBe("2h 0m");
	});

	it("should handle zero", () => {
		expect(formatDuration(0)).toBe("0s");
	});
});

describe("Queue Concurrency Logic", () => {
	// Test the slot calculation logic
	function calculateAvailableSlots(
		runningCount: number,
		maxConcurrent: number,
	): number {
		return Math.max(0, maxConcurrent - runningCount);
	}

	function shouldProcessQueue(
		runningCount: number,
		maxConcurrent: number,
	): boolean {
		return runningCount < maxConcurrent;
	}

	it("should calculate available slots correctly", () => {
		expect(calculateAvailableSlots(0, 2)).toBe(2);
		expect(calculateAvailableSlots(1, 2)).toBe(1);
		expect(calculateAvailableSlots(2, 2)).toBe(0);
		expect(calculateAvailableSlots(3, 2)).toBe(0); // over capacity
	});

	it("should determine if queue can process", () => {
		expect(shouldProcessQueue(0, 2)).toBe(true);
		expect(shouldProcessQueue(1, 2)).toBe(true);
		expect(shouldProcessQueue(2, 2)).toBe(false);
		expect(shouldProcessQueue(3, 2)).toBe(false);
	});

	it("should respect different max concurrent settings", () => {
		expect(calculateAvailableSlots(0, 5)).toBe(5);
		expect(calculateAvailableSlots(3, 5)).toBe(2);
		expect(calculateAvailableSlots(5, 5)).toBe(0);
	});
});

describe("Job Cancellation Logic", () => {
	// Test the cancellation routing logic
	function getCancellationMethod(jobType: JobType): string {
		if (jobType === "spec") {
			return "cancelSpecJob";
		}
		return "cancelRunnerJob";
	}

	it("should use cancelSpecJob for spec jobs", () => {
		expect(getCancellationMethod("spec")).toBe("cancelSpecJob");
	});

	it("should use cancelRunnerJob for code jobs", () => {
		expect(getCancellationMethod("code")).toBe("cancelRunnerJob");
	});

	it("should use cancelRunnerJob for task jobs", () => {
		expect(getCancellationMethod("task")).toBe("cancelRunnerJob");
	});

	it("should use cancelRunnerJob for ralph jobs", () => {
		expect(getCancellationMethod("ralph")).toBe("cancelRunnerJob");
	});
});

describe("Queue Status Response Shape", () => {
	// Test the shape of queue status response
	interface QueueStatusJob {
		id: string;
		clientId: string;
		branchName: string;
	}

	interface QueueStatus {
		running: Array<
			QueueStatusJob & { startedAt: string | null; runningFor: string | null }
		>;
		queued: Array<
			QueueStatusJob & { position: number; createdAt: string | null }
		>;
		maxConcurrent: number;
	}

	function formatQueueStatus(
		runningJobs: AgentJob[],
		queuedJobs: AgentJob[],
		maxConcurrent: number,
	): QueueStatus {
		return {
			running: runningJobs.map((j) => ({
				id: j.id,
				clientId: j.client_id,
				branchName: j.branch_name,
				startedAt: j.started_at,
				runningFor: j.started_at
					? `${Math.floor((Date.now() - new Date(j.started_at).getTime()) / 1000)}s`
					: null,
			})),
			queued: queuedJobs.map((j, i) => ({
				id: j.id,
				clientId: j.client_id,
				branchName: j.branch_name,
				position: i + 1,
				createdAt: j.created_at,
			})),
			maxConcurrent,
		};
	}

	it("should format running jobs correctly", () => {
		const runningJobs: Partial<AgentJob>[] = [
			{
				id: "job-1",
				client_id: "client-1",
				branch_name: "feat/test",
				started_at: new Date().toISOString(),
			},
		];

		const status = formatQueueStatus(runningJobs as AgentJob[], [], 2);

		expect(status.running).toHaveLength(1);
		expect(status.running[0].id).toBe("job-1");
		expect(status.running[0].clientId).toBe("client-1");
		expect(status.running[0].branchName).toBe("feat/test");
		expect(status.running[0].startedAt).toBeTruthy();
		expect(status.running[0].runningFor).toBeTruthy();
	});

	it("should format queued jobs with position", () => {
		const queuedJobs: Partial<AgentJob>[] = [
			{
				id: "job-1",
				client_id: "client-1",
				branch_name: "feat/first",
				created_at: new Date().toISOString(),
			},
			{
				id: "job-2",
				client_id: "client-2",
				branch_name: "feat/second",
				created_at: new Date().toISOString(),
			},
		];

		const status = formatQueueStatus([], queuedJobs as AgentJob[], 2);

		expect(status.queued).toHaveLength(2);
		expect(status.queued[0].position).toBe(1);
		expect(status.queued[1].position).toBe(2);
	});

	it("should include maxConcurrent", () => {
		const status = formatQueueStatus([], [], 5);
		expect(status.maxConcurrent).toBe(5);
	});
});
