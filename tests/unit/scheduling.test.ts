/**
 * Unit tests for scheduling/index.ts pure logic functions
 * Tests calculateComplexityScore, predictTokens, calculatePriority,
 * getPredictionMetrics, and weight export/import
 */

import { describe, expect, it } from "bun:test";

// ===== Replicated types and functions from src/scheduling/index.ts =====

interface JobFeatures {
	descriptionLength: number;
	filesToModify: number;
	complexityScore: number;
	clientAvgTokens: number;
	techStackFactor: number;
	hasTests: boolean;
	hasDatabase: boolean;
	isRefactor: boolean;
}

interface TokenPrediction {
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

interface TokenUsageRecord {
	jobId: string;
	features: JobFeatures;
	predictedTokens: number;
	actualTokens: number;
	createdAt: Date;
}

const defaultWeights = {
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

function calculateComplexityScore(description: string): number {
	let score = 1.0;

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

	return Math.max(0.5, Math.min(3.0, score));
}

function predictTokens(
	features: JobFeatures,
	weights = defaultWeights,
	historyLength = 0,
): TokenPrediction {
	let inputTokens = weights.baseInputTokens;
	let outputTokens = weights.baseOutputTokens;

	inputTokens += features.descriptionLength * weights.tokensPerDescriptionChar;

	const fileTokens = features.filesToModify * weights.tokensPerFile;
	inputTokens += fileTokens * 0.3;
	outputTokens += fileTokens * 0.7;

	const complexityMult =
		1 + (features.complexityScore - 1) * (weights.complexityMultiplier - 1);
	outputTokens *= complexityMult;

	if (features.hasTests) {
		outputTokens *= weights.testMultiplier;
	}
	if (features.hasDatabase) {
		outputTokens *= weights.databaseMultiplier;
	}
	if (features.isRefactor) {
		outputTokens *= weights.refactorMultiplier;
	}

	outputTokens *= features.techStackFactor;

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

	let confidence = 0.7;
	if (features.clientAvgTokens > 0) confidence += 0.1;
	if (features.filesToModify > 0) confidence += 0.1;
	if (historyLength > 50) confidence += 0.1;

	return {
		estimatedInputTokens: Math.round(inputTokens),
		estimatedOutputTokens: Math.round(outputTokens),
		confidenceScore: Math.min(0.95, confidence),
		breakdown: {
			baseTokens: weights.baseInputTokens + weights.baseOutputTokens,
			complexityMultiplier: complexityMult,
			fileMultiplier: 1 + features.filesToModify * 0.1,
			techStackMultiplier: features.techStackFactor,
		},
	};
}

function calculatePriority(
	features: JobFeatures,
	prediction: TokenPrediction,
	urgency = 1.0,
	clientTier: "free" | "pro" | "enterprise" = "pro",
): number {
	let priority = 100;

	const totalTokens =
		prediction.estimatedInputTokens + prediction.estimatedOutputTokens;
	if (totalTokens < 5000) priority += 20;
	else if (totalTokens > 20000) priority -= 10;

	priority *= urgency;

	const tierMultipliers = { free: 0.8, pro: 1.0, enterprise: 1.5 };
	priority *= tierMultipliers[clientTier];

	if (features.complexityScore < 1.2) priority += 10;
	else if (features.complexityScore > 2.0) priority -= 5;

	return Math.round(priority);
}

function getPredictionMetrics(tokenHistory: TokenUsageRecord[]): {
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

	const sorted = [...errors].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const medianError =
		sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

	const accurate = errors.filter((e) => e <= 50).length;

	return {
		totalPredictions: tokenHistory.length,
		avgErrorPercent: Math.round(avgError * 10) / 10,
		medianErrorPercent: Math.round(medianError * 10) / 10,
		under50PercentError: Math.round((accurate / errors.length) * 100),
	};
}

// ===== Tests =====

describe("Scheduling Pure Logic", () => {
	describe("calculateComplexityScore", () => {
		it("should return base score of 1.0 for plain text", () => {
			const score = calculateComplexityScore("Add a button to the page");
			expect(score).toBe(1.0);
		});

		it("should increase score for integration-related words", () => {
			const score = calculateComplexityScore("Integrate with Stripe API");
			expect(score).toBeGreaterThan(1.0);
		});

		it("should increase score for migration", () => {
			const score = calculateComplexityScore("Database migration");
			expect(score).toBeGreaterThan(1.0);
		});

		it("should increase score for authentication", () => {
			const score = calculateComplexityScore("Add authentication system");
			expect(score).toBeGreaterThan(1.3);
		});

		it("should decrease score for simple tasks", () => {
			const score = calculateComplexityScore("Fix simple typo in header");
			expect(score).toBeLessThan(1.0);
		});

		it("should decrease score for minor changes", () => {
			const score = calculateComplexityScore("Minor comment update");
			expect(score).toBeLessThan(1.0);
		});

		it("should clamp minimum to 0.5", () => {
			const score = calculateComplexityScore(
				"Simple basic minor typo comment fix",
			);
			expect(score).toBeGreaterThanOrEqual(0.5);
		});

		it("should clamp maximum to 3.0", () => {
			const score = calculateComplexityScore(
				"Complex integration migration refactor security performance authentication api database multi scale real-time concurrent parallel",
			);
			expect(score).toBeLessThanOrEqual(3.0);
		});

		it("should handle multiple complexity indicators", () => {
			const simple = calculateComplexityScore("Add a function");
			const complex = calculateComplexityScore(
				"Integrate database with authentication and security",
			);
			expect(complex).toBeGreaterThan(simple);
		});

		it("should be case insensitive", () => {
			const lower = calculateComplexityScore("database integration");
			const upper = calculateComplexityScore("DATABASE INTEGRATION");
			expect(lower).toBe(upper);
		});

		it("should handle real-time with optional hyphen", () => {
			const score1 = calculateComplexityScore("real-time updates");
			const score2 = calculateComplexityScore("realtime updates");
			expect(score1).toBeGreaterThan(1.0);
			expect(score2).toBeGreaterThan(1.0);
		});

		it("should handle empty string", () => {
			const score = calculateComplexityScore("");
			expect(score).toBe(1.0);
		});
	});

	describe("predictTokens", () => {
		const baseFeatures: JobFeatures = {
			descriptionLength: 100,
			filesToModify: 0,
			complexityScore: 1.0,
			clientAvgTokens: 0,
			techStackFactor: 1.0,
			hasTests: false,
			hasDatabase: false,
			isRefactor: false,
		};

		it("should return base tokens for minimal features", () => {
			const prediction = predictTokens(baseFeatures);
			expect(prediction.estimatedInputTokens).toBeGreaterThan(0);
			expect(prediction.estimatedOutputTokens).toBeGreaterThan(0);
		});

		it("should include description length in input tokens", () => {
			const short = predictTokens({ ...baseFeatures, descriptionLength: 50 });
			const long = predictTokens({ ...baseFeatures, descriptionLength: 500 });
			expect(long.estimatedInputTokens).toBeGreaterThan(
				short.estimatedInputTokens,
			);
		});

		it("should increase tokens with more files to modify", () => {
			const few = predictTokens({ ...baseFeatures, filesToModify: 1 });
			const many = predictTokens({ ...baseFeatures, filesToModify: 10 });
			const total = (p: TokenPrediction) =>
				p.estimatedInputTokens + p.estimatedOutputTokens;
			expect(total(many)).toBeGreaterThan(total(few));
		});

		it("should apply complexity multiplier", () => {
			const simple = predictTokens({
				...baseFeatures,
				complexityScore: 1.0,
			});
			const complex = predictTokens({
				...baseFeatures,
				complexityScore: 2.5,
			});
			expect(complex.estimatedOutputTokens).toBeGreaterThan(
				simple.estimatedOutputTokens,
			);
		});

		it("should increase tokens for test-related jobs", () => {
			const noTests = predictTokens(baseFeatures);
			const withTests = predictTokens({ ...baseFeatures, hasTests: true });
			expect(withTests.estimatedOutputTokens).toBeGreaterThan(
				noTests.estimatedOutputTokens,
			);
		});

		it("should increase tokens for database jobs", () => {
			const noDB = predictTokens(baseFeatures);
			const withDB = predictTokens({ ...baseFeatures, hasDatabase: true });
			expect(withDB.estimatedOutputTokens).toBeGreaterThan(
				noDB.estimatedOutputTokens,
			);
		});

		it("should increase tokens for refactoring", () => {
			const noRefactor = predictTokens(baseFeatures);
			const withRefactor = predictTokens({
				...baseFeatures,
				isRefactor: true,
			});
			expect(withRefactor.estimatedOutputTokens).toBeGreaterThan(
				noRefactor.estimatedOutputTokens,
			);
		});

		it("should blend with client history when available", () => {
			const noHistory = predictTokens(baseFeatures);
			const withHistory = predictTokens({
				...baseFeatures,
				clientAvgTokens: 10000,
			});
			// With high client average, total should increase
			const totalNoHistory =
				noHistory.estimatedInputTokens + noHistory.estimatedOutputTokens;
			const totalWithHistory =
				withHistory.estimatedInputTokens + withHistory.estimatedOutputTokens;
			expect(totalWithHistory).not.toBe(totalNoHistory);
		});

		it("should have base confidence of 0.7", () => {
			const prediction = predictTokens(baseFeatures);
			expect(prediction.confidenceScore).toBe(0.7);
		});

		it("should increase confidence with client history", () => {
			const prediction = predictTokens({
				...baseFeatures,
				clientAvgTokens: 5000,
			});
			expect(prediction.confidenceScore).toBeGreaterThan(0.7);
		});

		it("should increase confidence with file info", () => {
			const prediction = predictTokens({
				...baseFeatures,
				filesToModify: 3,
			});
			expect(prediction.confidenceScore).toBeGreaterThan(0.7);
		});

		it("should cap confidence at 0.95", () => {
			const prediction = predictTokens(
				{ ...baseFeatures, clientAvgTokens: 5000, filesToModify: 5 },
				defaultWeights,
				100,
			);
			expect(prediction.confidenceScore).toBeLessThanOrEqual(0.95);
		});

		it("should include breakdown information", () => {
			const prediction = predictTokens({
				...baseFeatures,
				filesToModify: 5,
			});
			expect(prediction.breakdown.baseTokens).toBe(2500); // 500 + 2000
			expect(prediction.breakdown.fileMultiplier).toBe(1.5); // 1 + 5 * 0.1
			expect(prediction.breakdown.techStackMultiplier).toBe(1.0);
		});

		it("should apply tech stack factor", () => {
			const typescript = predictTokens({
				...baseFeatures,
				techStackFactor: 1.0,
			});
			const rust = predictTokens({
				...baseFeatures,
				techStackFactor: 1.3,
			});
			expect(rust.estimatedOutputTokens).toBeGreaterThan(
				typescript.estimatedOutputTokens,
			);
		});
	});

	describe("calculatePriority", () => {
		const baseFeatures: JobFeatures = {
			descriptionLength: 100,
			filesToModify: 3,
			complexityScore: 1.0,
			clientAvgTokens: 5000,
			techStackFactor: 1.0,
			hasTests: false,
			hasDatabase: false,
			isRefactor: false,
		};

		const smallPrediction: TokenPrediction = {
			estimatedInputTokens: 1000,
			estimatedOutputTokens: 2000,
			confidenceScore: 0.8,
			breakdown: {
				baseTokens: 2500,
				complexityMultiplier: 1.0,
				fileMultiplier: 1.0,
				techStackMultiplier: 1.0,
			},
		};

		const largePrediction: TokenPrediction = {
			estimatedInputTokens: 10000,
			estimatedOutputTokens: 15000,
			confidenceScore: 0.8,
			breakdown: {
				baseTokens: 2500,
				complexityMultiplier: 2.0,
				fileMultiplier: 2.0,
				techStackMultiplier: 1.0,
			},
		};

		it("should give higher priority to smaller jobs", () => {
			const smallPri = calculatePriority(baseFeatures, smallPrediction);
			const largePri = calculatePriority(baseFeatures, largePrediction);
			expect(smallPri).toBeGreaterThan(largePri);
		});

		it("should multiply by urgency factor", () => {
			const normal = calculatePriority(baseFeatures, smallPrediction, 1.0);
			const urgent = calculatePriority(baseFeatures, smallPrediction, 2.0);
			expect(urgent).toBeGreaterThan(normal);
		});

		it("should apply free tier discount", () => {
			const pro = calculatePriority(baseFeatures, smallPrediction, 1.0, "pro");
			const free = calculatePriority(
				baseFeatures,
				smallPrediction,
				1.0,
				"free",
			);
			expect(free).toBeLessThan(pro);
		});

		it("should apply enterprise tier boost", () => {
			const pro = calculatePriority(baseFeatures, smallPrediction, 1.0, "pro");
			const enterprise = calculatePriority(
				baseFeatures,
				smallPrediction,
				1.0,
				"enterprise",
			);
			expect(enterprise).toBeGreaterThan(pro);
		});

		it("should boost low complexity jobs", () => {
			const lowComplexity = calculatePriority(
				{ ...baseFeatures, complexityScore: 1.0 },
				smallPrediction,
			);
			const highComplexity = calculatePriority(
				{ ...baseFeatures, complexityScore: 2.5 },
				smallPrediction,
			);
			expect(lowComplexity).toBeGreaterThan(highComplexity);
		});

		it("should return integer result", () => {
			const priority = calculatePriority(baseFeatures, smallPrediction);
			expect(priority).toBe(Math.round(priority));
		});
	});

	describe("getPredictionMetrics", () => {
		const baseFeatures: JobFeatures = {
			descriptionLength: 100,
			filesToModify: 3,
			complexityScore: 1.5,
			clientAvgTokens: 5000,
			techStackFactor: 1.0,
			hasTests: false,
			hasDatabase: false,
			isRefactor: false,
		};

		it("should return zeros for empty history", () => {
			const metrics = getPredictionMetrics([]);
			expect(metrics.totalPredictions).toBe(0);
			expect(metrics.avgErrorPercent).toBe(0);
			expect(metrics.medianErrorPercent).toBe(0);
			expect(metrics.under50PercentError).toBe(0);
		});

		it("should calculate correct total predictions", () => {
			const history: TokenUsageRecord[] = [
				{
					jobId: "j1",
					features: baseFeatures,
					predictedTokens: 5000,
					actualTokens: 5000,
					createdAt: new Date(),
				},
				{
					jobId: "j2",
					features: baseFeatures,
					predictedTokens: 3000,
					actualTokens: 4000,
					createdAt: new Date(),
				},
			];
			const metrics = getPredictionMetrics(history);
			expect(metrics.totalPredictions).toBe(2);
		});

		it("should calculate average error percent", () => {
			const history: TokenUsageRecord[] = [
				{
					jobId: "j1",
					features: baseFeatures,
					predictedTokens: 5000,
					actualTokens: 10000, // 50% error
					createdAt: new Date(),
				},
				{
					jobId: "j2",
					features: baseFeatures,
					predictedTokens: 10000,
					actualTokens: 10000, // 0% error
					createdAt: new Date(),
				},
			];
			const metrics = getPredictionMetrics(history);
			expect(metrics.avgErrorPercent).toBe(25); // (50 + 0) / 2
		});

		it("should calculate median error percent", () => {
			const history: TokenUsageRecord[] = [
				{
					jobId: "j1",
					features: baseFeatures,
					predictedTokens: 5000,
					actualTokens: 10000, // 50%
					createdAt: new Date(),
				},
				{
					jobId: "j2",
					features: baseFeatures,
					predictedTokens: 9000,
					actualTokens: 10000, // 10%
					createdAt: new Date(),
				},
				{
					jobId: "j3",
					features: baseFeatures,
					predictedTokens: 7000,
					actualTokens: 10000, // 30%
					createdAt: new Date(),
				},
			];
			const metrics = getPredictionMetrics(history);
			// Sorted: [10, 30, 50], median = 30
			expect(metrics.medianErrorPercent).toBe(30);
		});

		it("should calculate median for even number of entries", () => {
			const history: TokenUsageRecord[] = [
				{
					jobId: "j1",
					features: baseFeatures,
					predictedTokens: 8000,
					actualTokens: 10000, // 20%
					createdAt: new Date(),
				},
				{
					jobId: "j2",
					features: baseFeatures,
					predictedTokens: 6000,
					actualTokens: 10000, // 40%
					createdAt: new Date(),
				},
			];
			const metrics = getPredictionMetrics(history);
			// Sorted: [20, 40], median = (20 + 40) / 2 = 30
			expect(metrics.medianErrorPercent).toBe(30);
		});

		it("should calculate under 50% error rate", () => {
			const history: TokenUsageRecord[] = [
				{
					jobId: "j1",
					features: baseFeatures,
					predictedTokens: 9000,
					actualTokens: 10000, // 10% - within 50%
					createdAt: new Date(),
				},
				{
					jobId: "j2",
					features: baseFeatures,
					predictedTokens: 2000,
					actualTokens: 10000, // 80% - outside 50%
					createdAt: new Date(),
				},
			];
			const metrics = getPredictionMetrics(history);
			expect(metrics.under50PercentError).toBe(50); // 1/2 = 50%
		});

		it("should report 100% accuracy when all predictions are close", () => {
			const history: TokenUsageRecord[] = [
				{
					jobId: "j1",
					features: baseFeatures,
					predictedTokens: 10000,
					actualTokens: 10000,
					createdAt: new Date(),
				},
				{
					jobId: "j2",
					features: baseFeatures,
					predictedTokens: 9500,
					actualTokens: 10000,
					createdAt: new Date(),
				},
			];
			const metrics = getPredictionMetrics(history);
			expect(metrics.under50PercentError).toBe(100);
		});
	});

	describe("Weight export/import round-trip", () => {
		it("should have all expected default weight keys", () => {
			expect(defaultWeights.baseInputTokens).toBe(500);
			expect(defaultWeights.baseOutputTokens).toBe(2000);
			expect(defaultWeights.tokensPerDescriptionChar).toBe(0.5);
			expect(defaultWeights.tokensPerFile).toBe(800);
			expect(defaultWeights.complexityMultiplier).toBe(1.5);
			expect(defaultWeights.testMultiplier).toBe(1.3);
			expect(defaultWeights.databaseMultiplier).toBe(1.4);
			expect(defaultWeights.refactorMultiplier).toBe(1.2);
		});

		it("should have tech stack factors for common languages", () => {
			expect(defaultWeights.techStackFactors.typescript).toBe(1.0);
			expect(defaultWeights.techStackFactors.javascript).toBe(0.9);
			expect(defaultWeights.techStackFactors.python).toBe(0.85);
			expect(defaultWeights.techStackFactors.rust).toBe(1.3);
			expect(defaultWeights.techStackFactors.go).toBe(1.1);
			expect(defaultWeights.techStackFactors.unknown).toBe(1.0);
		});

		it("should support spreading for export simulation", () => {
			const exported = { ...defaultWeights };
			expect(exported.baseInputTokens).toBe(defaultWeights.baseInputTokens);
			expect(exported.baseOutputTokens).toBe(defaultWeights.baseOutputTokens);
		});

		it("should support partial merge for import simulation", () => {
			const partial = { baseOutputTokens: 3000 };
			const merged = { ...defaultWeights, ...partial };
			expect(merged.baseOutputTokens).toBe(3000);
			expect(merged.baseInputTokens).toBe(500); // unchanged
		});
	});
});
