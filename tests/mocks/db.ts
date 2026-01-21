/**
 * Mock database module for testing
 * Provides in-memory implementations of DB queries
 */

import type {
	AgentJob,
	AgentJobIteration,
	AgentJobMessage,
	Client,
	CodeRepository,
	Feature,
	JobWithDetails,
	SpecOutput,
} from "../../src/db/types.js";

// In-memory stores
let jobs: Map<string, AgentJob> = new Map();
let features: Map<string, Feature> = new Map();
let repositories: Map<string, CodeRepository> = new Map();
let clients: Map<string, Client> = new Map();
let messages: AgentJobMessage[] = [];
let iterations: AgentJobIteration[] = [];

// Reset all stores (call in beforeEach)
export function resetMockDb(): void {
	jobs = new Map();
	features = new Map();
	repositories = new Map();
	clients = new Map();
	messages = [];
	iterations = [];
}

// Seed functions for test setup
export function seedJob(job: Partial<AgentJob> & { id: string }): AgentJob {
	const fullJob: AgentJob = {
		id: job.id,
		client_id: job.client_id || "test-client-1",
		status: job.status || "queued",
		job_type: job.job_type || "code",
		branch_name: job.branch_name || "test-branch",
		prompt: job.prompt || "Test prompt",
		created_at: job.created_at || new Date().toISOString(),
		started_at: job.started_at || null,
		completed_at: job.completed_at || null,
		error: job.error || null,
		repository_id: job.repository_id || null,
		feature_id: job.feature_id || null,
		pull_request_id: job.pull_request_id || null,
		iteration_count: job.iteration_count || 0,
		max_iterations: job.max_iterations || 10,
		feedback_commands: job.feedback_commands || null,
		completion_reason: job.completion_reason || null,
		prd_mode: job.prd_mode || false,
		prd: job.prd || null,
		prd_progress: job.prd_progress || null,
		spec_phase: job.spec_phase || null,
		spec_output: job.spec_output || null,
	};
	jobs.set(job.id, fullJob);
	return fullJob;
}

export function seedFeature(
	feature: Partial<Feature> & { id: string },
): Feature {
	const fullFeature: Feature = {
		id: feature.id,
		title: feature.title || "Test Feature",
		description: feature.description || null,
		status: feature.status || "todo",
		priority: feature.priority || "medium",
		client_id: feature.client_id || "test-client-1",
		created_at: feature.created_at || new Date().toISOString(),
		updated_at: feature.updated_at || new Date().toISOString(),
		workflow_stage: feature.workflow_stage || null,
		functionality_notes: feature.functionality_notes || null,
		spec_output: feature.spec_output || null,
		assigned_to: feature.assigned_to || null,
		due_date: feature.due_date || null,
		estimated_hours: feature.estimated_hours || null,
		tags: feature.tags || null,
	};
	features.set(feature.id, fullFeature);
	return fullFeature;
}

export function seedRepository(
	repo: Partial<CodeRepository> & { id: string },
): CodeRepository {
	const fullRepo: CodeRepository = {
		id: repo.id,
		client_id: repo.client_id || "test-client-1",
		provider: repo.provider || "github",
		owner_name: repo.owner_name || "test-owner",
		repo_name: repo.repo_name || "test-repo",
		default_branch: repo.default_branch || "main",
		url: repo.url || "https://github.com/test-owner/test-repo",
		created_at: repo.created_at || new Date().toISOString(),
		updated_at: repo.updated_at || new Date().toISOString(),
	};
	repositories.set(repo.id, fullRepo);
	return fullRepo;
}

export function seedClient(client: Partial<Client> & { id: string }): Client {
	const fullClient: Client = {
		id: client.id,
		name: client.name || "Test Client",
		created_at: client.created_at || new Date().toISOString(),
		updated_at: client.updated_at || new Date().toISOString(),
		description: client.description || null,
		logo_url: client.logo_url || null,
		primary_contact_email: client.primary_contact_email || null,
		settings: client.settings || null,
	};
	clients.set(client.id, fullClient);
	return fullClient;
}

// Mock query implementations
export async function getJob(id: string): Promise<AgentJob | null> {
	return jobs.get(id) || null;
}

export async function getJobWithDetails(
	id: string,
): Promise<JobWithDetails | null> {
	const job = jobs.get(id);
	if (!job) return null;

	const client = clients.get(job.client_id);
	const feature = job.feature_id ? features.get(job.feature_id) : null;
	const repo = job.repository_id ? repositories.get(job.repository_id) : null;

	return {
		...job,
		client: client ? { id: client.id, name: client.name } : null,
		feature: feature ? { id: feature.id, title: feature.title } : null,
		repository: repo
			? {
					id: repo.id,
					owner_name: repo.owner_name,
					repo_name: repo.repo_name,
					default_branch: repo.default_branch,
				}
			: null,
	};
}

export async function updateJob(
	id: string,
	updates: Partial<AgentJob>,
): Promise<AgentJob | null> {
	const job = jobs.get(id);
	if (!job) return null;

	const updated = { ...job, ...updates };
	jobs.set(id, updated);
	return updated;
}

export async function getQueuedJobs(): Promise<AgentJob[]> {
	return Array.from(jobs.values()).filter((j) => j.status === "queued");
}

export async function getRunningJobs(): Promise<AgentJob[]> {
	return Array.from(jobs.values()).filter((j) => j.status === "running");
}

export async function getFeature(id: string): Promise<Feature | null> {
	return features.get(id) || null;
}

export async function getFeatureSpecOutput(
	featureId: string,
): Promise<SpecOutput | null> {
	const feature = features.get(featureId);
	return (feature?.spec_output as SpecOutput) || null;
}

export async function updateFeatureSpecOutput(
	featureId: string,
	specOutput: SpecOutput,
): Promise<void> {
	const feature = features.get(featureId);
	if (feature) {
		feature.spec_output = specOutput as unknown as Feature["spec_output"];
		features.set(featureId, feature);
	}
}

export async function getRepositoryById(
	id: string,
): Promise<CodeRepository | null> {
	return repositories.get(id) || null;
}

export async function getRepositoryByClientId(
	clientId: string,
): Promise<CodeRepository | null> {
	return (
		Array.from(repositories.values()).find((r) => r.client_id === clientId) ||
		null
	);
}

export async function addJobMessage(
	jobId: string,
	role: "user" | "assistant" | "system",
	content: string,
): Promise<AgentJobMessage> {
	const message: AgentJobMessage = {
		id: `msg-${messages.length + 1}`,
		job_id: jobId,
		role,
		content,
		created_at: new Date().toISOString(),
	};
	messages.push(message);
	return message;
}

export async function getJobMessages(
	jobId: string,
): Promise<AgentJobMessage[]> {
	return messages.filter((m) => m.job_id === jobId);
}

export async function createJobIteration(
	iteration: Partial<AgentJobIteration> & { job_id: string },
): Promise<AgentJobIteration> {
	const fullIteration: AgentJobIteration = {
		id: iteration.id || `iter-${iterations.length + 1}`,
		job_id: iteration.job_id,
		iteration_number: iteration.iteration_number || iterations.length + 1,
		started_at: iteration.started_at || new Date().toISOString(),
		completed_at: iteration.completed_at || null,
		prompt_used: iteration.prompt_used || null,
		output_summary: iteration.output_summary || null,
		promise_detected: iteration.promise_detected || false,
		feedback_results: iteration.feedback_results || null,
		exit_code: iteration.exit_code || null,
		pid: iteration.pid || null,
	};
	iterations.push(fullIteration);
	return fullIteration;
}

// Getters for test assertions
export function getStoredJobs(): AgentJob[] {
	return Array.from(jobs.values());
}

export function getStoredMessages(): AgentJobMessage[] {
	return messages;
}

export function getStoredIterations(): AgentJobIteration[] {
	return iterations;
}
