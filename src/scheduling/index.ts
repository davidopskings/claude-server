/**
 * Predictive Scheduling
 *
 * ML-based token estimation and capacity-aware job scheduling.
 * Learns from actual token usage to improve predictions over time.
 */

import { supabase } from "../db/index.js";

// Extended job type with scheduling columns (from migration 0011)
// These columns exist in the database but may not be in generated types yet
interface AgentJobWithScheduling {
	id: string;
	client_id: string;
	status: string;
	created_at: string | null;
	token_usage: number | null;
	metadata: {
		scheduling?: {
			priority?: number;
			estimatedTokens?: number;
			estimatedDurationMs?: number;
			scheduledAt?: string;
		};
	} | null;
}

export interface JobFeatures {
	descriptionLength: number;
	filesToModify: number;
	complexityScore: number;
	clientAvgTokens: number;
	techStackFactor: number;
	hasTests: boolean;
	hasDatabase: boolean;
	isRefactor: boolean;
}

export interface TokenPrediction {
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	confidenceScore: number;
	breakdown: {
		baseTokens: number;
		complexityMultiplier: number;
		fileMultiplier: number;
		techStackMultiplier: number;
	};
}

export interface ScheduledJob {
	jobId: string;
	priority: number;
	estimatedTokens: number;
	estimatedDurationMs: number;
	scheduledAt: Date;
	dependencies: string[];
}

export interface CapacityInfo {
	currentLoad: number;
	maxCapacity: number;
	availableSlots: number;
	queueDepth: number;
	estimatedWaitMs: number;
}

// Token usage history for learning
interface TokenUsageRecord {
	jobId: string;
	features: JobFeatures;
	predictedTokens: number;
	actualTokens: number;
	createdAt: Date;
}

// In-memory learning data
const tokenHistory: TokenUsageRecord[] = [];
const MAX_HISTORY = 1000;

// Default weights (will be adjusted through learning)
let predictionWeights = {
	baseInputTokens: 500,
	baseOutputTokens: 2000,
	tokensPerDescriptionChar: 0.5,
	tokensPerFile: 800,
	complexityMultiplier: 1.5,
	testMultiplier: 1.3,
	databaseMultiplier: 1.4,
	refactorMultiplier: 1.2,
	techStackFactors: {
		typescript: 1.0,
		javascript: 0.9,
		python: 0.85,
		rust: 1.3,
		go: 1.1,
		unknown: 1.0,
	} as Record<string, number>,
};

/**
 * Extract features from a job for prediction
 */
export async function extractJobFeatures(
	jobId: string,
	description: string,
	filesToModify: string[] = [],
	techStack = "typescript",
): Promise<JobFeatures> {
	// Get client's historical average
	const clientAvgTokens = await getClientAverageTokens(jobId);

	// Analyze description for complexity indicators
	const complexityScore = calculateComplexityScore(description);

	// Check for specific patterns
	const lowerDesc = description.toLowerCase();
	const hasTests = lowerDesc.includes("test") || lowerDesc.includes("spec");
	const hasDatabase =
		lowerDesc.includes("database") ||
		lowerDesc.includes("migration") ||
		lowerDesc.includes("prisma") ||
		lowerDesc.includes("drizzle");
	const isRefactor =
		lowerDesc.includes("refactor") ||
		lowerDesc.includes("rewrite") ||
		lowerDesc.includes("restructure");

	// Get tech stack factor
	const techStackFactor =
		predictionWeights.techStackFactors[techStack.toLowerCase()] ||
		predictionWeights.techStackFactors.unknown;

	return {
		descriptionLength: description.length,
		filesToModify: filesToModify.length,
		complexityScore,
		clientAvgTokens,
		techStackFactor,
		hasTests,
		hasDatabase,
		isRefactor,
	};
}

/**
 * Calculate complexity score from description
 */
function calculateComplexityScore(description: string): number {
	const _lowerDesc = description.toLowerCase();
	let score = 1.0;

	// Complexity indicators
	const complexIndicators = [
		{ pattern: /integrat/i, weight: 0.3 },
		{ pattern: /migrat/i, weight: 0.4 },
		{ pattern: /refactor/i, weight: 0.3 },
		{ pattern: /security/i, weight: 0.3 },
		{ pattern: /performance/i, weight: 0.2 },
		{ pattern: /authentication/i, weight: 0.4 },
		{ pattern: /api/i, weight: 0.2 },
		{ pattern: /database/i, weight: 0.3 },
		{ pattern: /multi/i, weight: 0.2 },
		{ pattern: /complex/i, weight: 0.3 },
		{ pattern: /scale/i, weight: 0.2 },
		{ pattern: /real.?time/i, weight: 0.4 },
		{ pattern: /concurrent/i, weight: 0.3 },
		{ pattern: /parallel/i, weight: 0.2 },
	];

	for (const indicator of complexIndicators) {
		if (indicator.pattern.test(description)) {
			score += indicator.weight;
		}
	}

	// Simplicity indicators (reduce complexity)
	const simpleIndicators = [
		{ pattern: /simple/i, weight: -0.2 },
		{ pattern: /basic/i, weight: -0.2 },
		{ pattern: /minor/i, weight: -0.3 },
		{ pattern: /typo/i, weight: -0.4 },
		{ pattern: /comment/i, weight: -0.3 },
	];

	for (const indicator of simpleIndicators) {
		if (indicator.pattern.test(description)) {
			score += indicator.weight;
		}
	}

	// Clamp between 0.5 and 3.0
	return Math.max(0.5, Math.min(3.0, score));
}

/**
 * Get client's historical average token usage
 */
async function getClientAverageTokens(jobId: string): Promise<number> {
	try {
		// Get client_id from job
		const { data: job } = await supabase
			.from("agent_jobs")
			.select("client_id")
			.eq("id", jobId)
			.single();

		if (!job?.client_id) return 5000; // Default

		// Get average from recent jobs with token_usage
		const { data: jobs } = (await supabase
			.from("agent_jobs")
			.select("token_usage")
			.eq("client_id", job.client_id)
			.not("token_usage", "is", null)
			.order("created_at", { ascending: false })
			.limit(20)) as {
			data: Pick<AgentJobWithScheduling, "token_usage">[] | null;
		};

		if (!jobs || jobs.length === 0) return 5000;

		const total = jobs.reduce((sum, j) => sum + (j.token_usage || 0), 0);
		return Math.round(total / jobs.length);
	} catch {
		return 5000; // Default on error
	}
}

/**
 * Predict token usage for a job
 */
export function predictTokens(features: JobFeatures): TokenPrediction {
	// Base tokens
	let inputTokens = predictionWeights.baseInputTokens;
	let outputTokens = predictionWeights.baseOutputTokens;

	// Add tokens based on description length
	inputTokens +=
		features.descriptionLength * predictionWeights.tokensPerDescriptionChar;

	// Add tokens per file to modify
	const fileTokens = features.filesToModify * predictionWeights.tokensPerFile;
	inputTokens += fileTokens * 0.3; // Reading files
	outputTokens += fileTokens * 0.7; // Writing files

	// Apply complexity multiplier
	const complexityMult =
		1 +
		(features.complexityScore - 1) *
			(predictionWeights.complexityMultiplier - 1);
	outputTokens *= complexityMult;

	// Apply modifiers
	if (features.hasTests) {
		outputTokens *= predictionWeights.testMultiplier;
	}
	if (features.hasDatabase) {
		outputTokens *= predictionWeights.databaseMultiplier;
	}
	if (features.isRefactor) {
		outputTokens *= predictionWeights.refactorMultiplier;
	}

	// Apply tech stack factor
	outputTokens *= features.techStackFactor;

	// Blend with client's historical average
	if (features.clientAvgTokens > 0) {
		const historyWeight = 0.3;
		const predictedTotal = inputTokens + outputTokens;
		const blendedTotal =
			predictedTotal * (1 - historyWeight) +
			features.clientAvgTokens * historyWeight;
		const ratio = inputTokens / (inputTokens + outputTokens);
		inputTokens = blendedTotal * ratio;
		outputTokens = blendedTotal * (1 - ratio);
	}

	// Calculate confidence based on feature completeness
	let confidence = 0.7;
	if (features.clientAvgTokens > 0) confidence += 0.1;
	if (features.filesToModify > 0) confidence += 0.1;
	if (tokenHistory.length > 50) confidence += 0.1; // More history = better predictions

	return {
		estimatedInputTokens: Math.round(inputTokens),
		estimatedOutputTokens: Math.round(outputTokens),
		confidenceScore: Math.min(0.95, confidence),
		breakdown: {
			baseTokens:
				predictionWeights.baseInputTokens + predictionWeights.baseOutputTokens,
			complexityMultiplier: complexityMult,
			fileMultiplier: 1 + features.filesToModify * 0.1,
			techStackMultiplier: features.techStackFactor,
		},
	};
}

/**
 * Record actual token usage for learning
 */
export function recordActualUsage(
	jobId: string,
	features: JobFeatures,
	predictedTokens: number,
	actualTokens: number,
): void {
	tokenHistory.push({
		jobId,
		features,
		predictedTokens,
		actualTokens,
		createdAt: new Date(),
	});

	// Trim history if needed
	if (tokenHistory.length > MAX_HISTORY) {
		tokenHistory.splice(0, tokenHistory.length - MAX_HISTORY);
	}

	// Trigger learning if we have enough data
	if (tokenHistory.length >= 20 && tokenHistory.length % 10 === 0) {
		adjustWeights();
	}
}

/**
 * Adjust prediction weights based on historical accuracy
 */
function adjustWeights(): void {
	if (tokenHistory.length < 20) return;

	const recentHistory = tokenHistory.slice(-100);

	// Calculate average prediction error
	let totalError = 0;
	const complexityErrors: number[] = [];
	const fileErrors: number[] = [];

	for (const record of recentHistory) {
		const error =
			(record.actualTokens - record.predictedTokens) / record.actualTokens;
		totalError += error;

		// Track errors by feature for targeted adjustment
		if (record.features.complexityScore > 1.5) {
			complexityErrors.push(error);
		}
		if (record.features.filesToModify > 3) {
			fileErrors.push(error);
		}
	}

	const avgError = totalError / recentHistory.length;

	// Adjust base tokens if consistently off
	if (Math.abs(avgError) > 0.1) {
		const adjustment = 1 + avgError * 0.5; // Conservative adjustment
		predictionWeights.baseOutputTokens *= adjustment;
	}

	// Adjust complexity multiplier if complex jobs are off
	if (complexityErrors.length > 5) {
		const avgComplexError =
			complexityErrors.reduce((a, b) => a + b, 0) / complexityErrors.length;
		if (Math.abs(avgComplexError) > 0.15) {
			predictionWeights.complexityMultiplier *= 1 + avgComplexError * 0.3;
		}
	}

	// Adjust file multiplier if file-heavy jobs are off
	if (fileErrors.length > 5) {
		const avgFileError =
			fileErrors.reduce((a, b) => a + b, 0) / fileErrors.length;
		if (Math.abs(avgFileError) > 0.15) {
			predictionWeights.tokensPerFile *= 1 + avgFileError * 0.3;
		}
	}

	console.log(
		`[SCHEDULER] Adjusted weights. Avg error: ${(avgError * 100).toFixed(1)}%`,
	);
}

/**
 * Get current system capacity
 */
export async function getCapacity(): Promise<CapacityInfo> {
	try {
		// Count active jobs
		const { count: activeJobs } = await supabase
			.from("agent_jobs")
			.select("*", { count: "exact", head: true })
			.in("status", ["pending", "running"]);

		// Count queued jobs
		const { count: queuedJobs } = await supabase
			.from("agent_jobs")
			.select("*", { count: "exact", head: true })
			.eq("status", "pending");

		const maxCapacity = 10; // Configurable max concurrent jobs
		const currentLoad = activeJobs || 0;
		const availableSlots = Math.max(0, maxCapacity - currentLoad);

		// Estimate wait time based on queue depth and average job duration
		const avgJobDurationMs = 60000; // 1 minute average, should be learned
		const estimatedWaitMs = queuedJobs
			? (queuedJobs * avgJobDurationMs) / maxCapacity
			: 0;

		return {
			currentLoad,
			maxCapacity,
			availableSlots,
			queueDepth: queuedJobs || 0,
			estimatedWaitMs: Math.round(estimatedWaitMs),
		};
	} catch {
		return {
			currentLoad: 0,
			maxCapacity: 10,
			availableSlots: 10,
			queueDepth: 0,
			estimatedWaitMs: 0,
		};
	}
}

/**
 * Calculate job priority score
 */
export function calculatePriority(
	features: JobFeatures,
	prediction: TokenPrediction,
	urgency = 1.0,
	clientTier: "free" | "pro" | "enterprise" = "pro",
): number {
	let priority = 100;

	// Higher priority for smaller jobs (faster turnaround)
	const totalTokens =
		prediction.estimatedInputTokens + prediction.estimatedOutputTokens;
	if (totalTokens < 5000) priority += 20;
	else if (totalTokens > 20000) priority -= 10;

	// Urgency factor
	priority *= urgency;

	// Client tier factor
	const tierMultipliers = { free: 0.8, pro: 1.0, enterprise: 1.5 };
	priority *= tierMultipliers[clientTier];

	// Lower complexity jobs get slight priority (less risk of timeout)
	if (features.complexityScore < 1.2) priority += 10;
	else if (features.complexityScore > 2.0) priority -= 5;

	return Math.round(priority);
}

/**
 * Schedule a job based on current capacity and priority
 */
export async function scheduleJob(
	jobId: string,
	features: JobFeatures,
	prediction: TokenPrediction,
	dependencies: string[] = [],
): Promise<ScheduledJob> {
	const capacity = await getCapacity();
	const priority = calculatePriority(features, prediction);

	// Estimate when job can start
	let scheduledAt = new Date();
	if (capacity.availableSlots === 0) {
		scheduledAt = new Date(Date.now() + capacity.estimatedWaitMs);
	}

	// Check dependencies
	if (dependencies.length > 0) {
		const { data: depJobs } = await supabase
			.from("agent_jobs")
			.select("status, completed_at")
			.in("id", dependencies);

		if (depJobs) {
			const pendingDeps = depJobs.filter((j) => j.status !== "completed");
			if (pendingDeps.length > 0) {
				// Delay scheduling until dependencies complete
				scheduledAt = new Date(Date.now() + 300000); // 5 min default delay
			}
		}
	}

	// Estimate duration
	const tokensPerSecond = 50; // Approximate Claude speed
	const totalTokens =
		prediction.estimatedInputTokens + prediction.estimatedOutputTokens;
	const estimatedDurationMs = Math.round(
		(totalTokens / tokensPerSecond) * 1000,
	);

	const scheduled: ScheduledJob = {
		jobId,
		priority,
		estimatedTokens: totalTokens,
		estimatedDurationMs,
		scheduledAt,
		dependencies,
	};

	// Store scheduling info in metadata
	await supabase
		.from("agent_jobs")
		.update({
			metadata: {
				scheduling: {
					priority,
					estimatedTokens: totalTokens,
					estimatedDurationMs,
					scheduledAt: scheduledAt.toISOString(),
				},
			},
		} as unknown as Record<string, unknown>)
		.eq("id", jobId);

	return scheduled;
}

/**
 * Get next jobs to run based on scheduling
 */
export async function getNextJobs(limit = 5): Promise<ScheduledJob[]> {
	const { data: jobs } = (await supabase
		.from("agent_jobs")
		.select("id, metadata")
		.eq("status", "pending")
		.order("created_at", { ascending: true })
		.limit(limit * 2)) as {
		data: Pick<AgentJobWithScheduling, "id" | "metadata">[] | null;
	};

	if (!jobs || jobs.length === 0) return [];

	const scheduled: ScheduledJob[] = jobs
		.filter((j) => j.metadata?.scheduling)
		.map((j) => ({
			jobId: j.id,
			priority: j.metadata?.scheduling?.priority || 50,
			estimatedTokens: j.metadata?.scheduling?.estimatedTokens || 5000,
			estimatedDurationMs: j.metadata?.scheduling?.estimatedDurationMs || 60000,
			scheduledAt: new Date(j.metadata?.scheduling?.scheduledAt || Date.now()),
			dependencies: [],
		}))
		.sort((a, b) => {
			// Primary: scheduled time
			if (a.scheduledAt.getTime() !== b.scheduledAt.getTime()) {
				return a.scheduledAt.getTime() - b.scheduledAt.getTime();
			}
			// Secondary: priority (higher = first)
			return b.priority - a.priority;
		});

	return scheduled.slice(0, limit);
}

/**
 * Get prediction accuracy metrics
 */
export function getPredictionMetrics(): {
	totalPredictions: number;
	avgErrorPercent: number;
	medianErrorPercent: number;
	under50PercentError: number;
} {
	if (tokenHistory.length === 0) {
		return {
			totalPredictions: 0,
			avgErrorPercent: 0,
			medianErrorPercent: 0,
			under50PercentError: 0,
		};
	}

	const errors = tokenHistory.map(
		(r) =>
			Math.abs((r.actualTokens - r.predictedTokens) / r.actualTokens) * 100,
	);

	const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;

	// Calculate median
	const sorted = [...errors].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const medianError =
		sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

	// Count predictions within 50% accuracy
	const accurate = errors.filter((e) => e <= 50).length;

	return {
		totalPredictions: tokenHistory.length,
		avgErrorPercent: Math.round(avgError * 10) / 10,
		medianErrorPercent: Math.round(medianError * 10) / 10,
		under50PercentError: Math.round((accurate / errors.length) * 100),
	};
}

/**
 * Export current weights (for persistence)
 */
export function exportWeights(): typeof predictionWeights {
	return { ...predictionWeights };
}

/**
 * Import weights (from persistence)
 */
export function importWeights(
	weights: Partial<typeof predictionWeights>,
): void {
	predictionWeights = { ...predictionWeights, ...weights };
}
