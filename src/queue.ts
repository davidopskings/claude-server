import {
	getJob,
	getQueuedJobs,
	getRunningJobs,
	updateJob,
} from "./db/index.js";
import {
	cancelJob as cancelRunningJob,
	runJob,
	runPrdGenerationJob,
	runRalphJob,
	runRalphPrdJob,
} from "./runner.js";
import { cancelSpecJob, runSpecJob } from "./spec/runner.js";

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || "2", 10);

let processing = false;
let runningCount = 0;

export async function processQueue(): Promise<void> {
	if (processing) return;
	processing = true;

	try {
		const running = await getRunningJobs();
		runningCount = running.length;

		if (running.length >= MAX_CONCURRENT) {
			return;
		}

		const queued = await getQueuedJobs();
		const slotsAvailable = MAX_CONCURRENT - running.length;
		const jobsToRun = queued.slice(0, slotsAvailable);

		for (const job of jobsToRun) {
			runningCount++;
			// Choose runner based on job type and mode
			let runner: (jobId: string) => Promise<void> = runJob;
			if (job.job_type === "ralph") {
				runner = job.prd_mode ? runRalphPrdJob : runRalphJob;
			} else if (job.job_type === "prd_generation") {
				runner = runPrdGenerationJob;
			} else if (job.job_type === "spec") {
				runner = runSpecJob;
			}
			// Don't await - run in parallel
			runner(job.id)
				.catch((err) => console.error(`Error running job ${job.id}:`, err))
				.finally(() => {
					runningCount--;
					processQueue();
				});
		}
	} finally {
		processing = false;
	}
}

export async function getQueueStatus(): Promise<{
	running: Array<{
		id: string;
		clientId: string;
		branchName: string;
		startedAt: string | null;
		runningFor: string | null;
	}>;
	queued: Array<{
		id: string;
		clientId: string;
		branchName: string;
		position: number;
		createdAt: string | null;
	}>;
	maxConcurrent: number;
}> {
	const running = await getRunningJobs();
	const queued = await getQueuedJobs();

	return {
		running: running.map((j) => ({
			id: j.id,
			clientId: j.client_id,
			branchName: j.branch_name,
			startedAt: j.started_at,
			runningFor: j.started_at
				? formatDuration(Date.now() - new Date(j.started_at).getTime())
				: null,
		})),
		queued: queued.map((j, i) => ({
			id: j.id,
			clientId: j.client_id,
			branchName: j.branch_name,
			position: i + 1,
			createdAt: j.created_at,
		})),
		maxConcurrent: MAX_CONCURRENT,
	};
}

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

export async function cancelJob(jobId: string): Promise<boolean> {
	const job = await getJob(jobId);
	if (!job) return false;

	// If running, kill the process
	if (job.status === "running") {
		if (job.job_type === "spec") {
			cancelSpecJob(jobId);
		} else {
			cancelRunningJob(jobId);
		}
	}

	await updateJob(jobId, {
		status: "cancelled",
		completed_at: new Date().toISOString(),
	});

	return true;
}

export function getRunningCount(): number {
	return runningCount;
}

export async function getQueuedCount(): Promise<number> {
	const queued = await getQueuedJobs();
	return queued.length;
}

// Initialize queue processing on startup
export async function initQueue(): Promise<void> {
	console.log(`Queue initialized with max ${MAX_CONCURRENT} concurrent jobs`);

	// Mark any stale running jobs as failed (from server restart)
	const running = await getRunningJobs();
	for (const job of running) {
		console.log(`Marking stale job ${job.id} as failed (server restart)`);
		await updateJob(job.id, {
			status: "failed",
			error: "Job was interrupted by server restart",
			completed_at: new Date().toISOString(),
		});
	}

	// Start processing queue
	await processQueue();
}
