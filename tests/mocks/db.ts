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
	SpecPhase,
} from "../../src/db/types.js";

// ----- SPEC_STAGE_CODES constant (mirrors src/db/queries.ts) -----

export const SPEC_STAGE_CODES = {
	constitution_running: "constitution_running",
	constitution_complete: "constitution_complete",
	specify_running: "specify_running",
	specify_clarify: "specify_clarify",
	specify_dev_review: "specify_dev_review",
	specify_ba_review: "specify_ba_review",
	specify_complete: "specify_complete",
	clarify_running: "clarify_running",
	clarify_waiting: "clarify_waiting",
	clarify_complete: "clarify_complete",
	plan_running: "plan_running",
	plan_clarify: "plan_clarify",
	plan_dev_review: "plan_dev_review",
	plan_ba_review: "plan_ba_review",
	plan_complete: "plan_complete",
	analyze_running: "analyze_running",
	analyze_failed: "analyze_failed",
	analyze_complete: "analyze_complete",
	improve_running: "improve_running",
	improve_clarify: "improve_clarify",
	improve_complete: "improve_complete",
	tasks_running: "tasks_running",
	tasks_clarify: "tasks_clarify",
	tasks_complete: "tasks_complete",
	spec_complete: "spec_complete",
} as const;

// ----- Client Constitution types -----

export interface ClientConstitution {
	constitution: string;
	generatedAt: string;
}

// In-memory stores
let jobs: Map<string, AgentJob> = new Map();
let features: Map<string, Feature> = new Map();
let repositories: Map<string, CodeRepository> = new Map();
let clients: Map<string, Client> = new Map();
let messages: AgentJobMessage[] = [];
let iterations: AgentJobIteration[] = [];
let clientConstitutions: Map<string, ClientConstitution> = new Map();
let workflowStageUpdates: Array<{ featureId: string; stageCode: string }> = [];
let specJobCreations: Array<{
	clientId: string;
	featureId: string | null;
	repositoryId?: string;
	specPhase: SpecPhase;
}> = [];

// Reset all stores (call in beforeEach)
export function resetMockDb(): void {
	jobs = new Map();
	features = new Map();
	repositories = new Map();
	clients = new Map();
	messages = [];
	iterations = [];
	clientConstitutions = new Map();
	workflowStageUpdates = [];
	specJobCreations = [];
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
		updated_at: job.updated_at || null,
		started_at: job.started_at || null,
		completed_at: job.completed_at || null,
		error: job.error || null,
		repository_id: job.repository_id || null,
		feature_id: job.feature_id || null,
		code_branch_id: job.code_branch_id || null,
		code_pull_request_id: job.code_pull_request_id || null,
		completion_promise: job.completion_promise || null,
		completion_reason: job.completion_reason || null,
		created_by_team_member_id: job.created_by_team_member_id || null,
		current_iteration: job.current_iteration || null,
		exit_code: job.exit_code || null,
		feedback_commands: job.feedback_commands || null,
		files_changed: job.files_changed || null,
		max_iterations: job.max_iterations || 10,
		pid: job.pid || null,
		pr_number: job.pr_number || null,
		pr_url: job.pr_url || null,
		prd: job.prd || null,
		prd_mode: job.prd_mode || false,
		prd_progress: job.prd_progress || null,
		spec_phase: job.spec_phase || null,
		spec_output: job.spec_output || null,
		title: job.title || null,
		total_iterations: job.total_iterations || null,
		worktree_path: job.worktree_path || null,
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
		client_id: feature.client_id || "test-client-1",
		created_at: feature.created_at || new Date().toISOString(),
		updated_at: feature.updated_at || new Date().toISOString(),
		actual_ship_date: feature.actual_ship_date || null,
		branch_name: feature.branch_name || null,
		branch_name_hint: feature.branch_name_hint || null,
		client_context: feature.client_context || null,
		created_by_team_member_id: feature.created_by_team_member_id || null,
		estimate_points: feature.estimate_points || null,
		estimated_ship_date: feature.estimated_ship_date || null,
		feature_type_id: feature.feature_type_id || null,
		feature_workflow_stage_id: feature.feature_workflow_stage_id || null,
		functionality_notes: feature.functionality_notes || null,
		initiative_id: feature.initiative_id || null,
		key: feature.key || null,
		originating_request_id: feature.originating_request_id || null,
		owner_team_member_id: feature.owner_team_member_id || null,
		prd: feature.prd || null,
		sort_index: feature.sort_index || null,
		spec_output: feature.spec_output || null,
		spec_phase: feature.spec_phase || null,
		sprint_id: feature.sprint_id || null,
		workflow_stage_id: feature.workflow_stage_id || null,
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
		external_id: repo.external_id || null,
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
		assigned_business_analyst: client.assigned_business_analyst || null,
		assigned_developer: client.assigned_developer || null,
		assumed_first_payment_date: client.assumed_first_payment_date || null,
		billing_workflow_stage_id: client.billing_workflow_stage_id || null,
		client_source: client.client_source || null,
		industry: client.industry || null,
		max_story_point_per_sprint: client.max_story_point_per_sprint || null,
		notes: client.notes || null,
		onboarding_workflow_stage_id: client.onboarding_workflow_stage_id || null,
		sales_call_notes: client.sales_call_notes || null,
		sales_strategy: client.sales_strategy || null,
		sprint_prefix: client.sprint_prefix || null,
		subjective_happiness: client.subjective_happiness || null,
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
	return (feature?.spec_output as unknown as SpecOutput) || null;
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
	type: "stdout" | "stderr" | "system" | "user_input",
	content: string,
): Promise<void> {
	const message: AgentJobMessage = {
		id: `msg-${messages.length + 1}`,
		job_id: jobId,
		type,
		content,
		created_at: new Date().toISOString(),
	};
	messages.push(message);
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
		created_at: iteration.created_at || new Date().toISOString(),
		commit_sha: iteration.commit_sha || null,
		error: iteration.error || null,
		prompt_used: iteration.prompt_used || null,
		output_summary: iteration.output_summary || null,
		promise_detected: iteration.promise_detected || false,
		feedback_results: iteration.feedback_results || null,
		exit_code: iteration.exit_code || null,
		pid: iteration.pid || null,
		story_id: iteration.story_id || null,
	};
	iterations.push(fullIteration);
	return fullIteration;
}

// ----- Spec-Kit specific functions -----

export async function createSpecJob(params: {
	clientId: string;
	featureId: string | null;
	repositoryId?: string;
	specPhase: SpecPhase;
	createdByTeamMemberId?: string;
	specOutput?: Record<string, unknown>;
}): Promise<AgentJob> {
	specJobCreations.push({
		clientId: params.clientId,
		featureId: params.featureId,
		repositoryId: params.repositoryId,
		specPhase: params.specPhase,
	});

	const branchSlug = params.featureId
		? `spec-${params.featureId.slice(0, 8)}`
		: `constitution-${params.clientId.slice(0, 8)}`;

	const job = seedJob({
		id: `job-spec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		client_id: params.clientId,
		feature_id: params.featureId,
		repository_id: params.repositoryId || null,
		job_type: "spec",
		spec_phase: params.specPhase,
		status: "queued",
		branch_name: `${branchSlug}-${Date.now()}`,
		prompt: `Run Spec-Kit phase: ${params.specPhase}`,
		spec_output: params.specOutput
			? (params.specOutput as AgentJob["spec_output"])
			: null,
	});
	return job;
}

export async function getClientConstitution(
	clientId: string,
): Promise<ClientConstitution | null> {
	return clientConstitutions.get(clientId) || null;
}

export async function updateClientConstitution(
	clientId: string,
	constitution: string,
): Promise<void> {
	clientConstitutions.set(clientId, {
		constitution,
		generatedAt: new Date().toISOString(),
	});
}

export async function updateFeatureWorkflowStageByCode(
	featureId: string,
	stageCode: string,
): Promise<boolean> {
	workflowStageUpdates.push({ featureId, stageCode });
	return true;
}

// ----- Seed helpers for new stores -----

export function seedClientConstitution(
	clientId: string,
	constitution: string,
	generatedAt?: string,
): void {
	clientConstitutions.set(clientId, {
		constitution,
		generatedAt: generatedAt || new Date().toISOString(),
	});
}

// ----- Getters for test assertions -----

export function getStoredJobs(): AgentJob[] {
	return Array.from(jobs.values());
}

export function getStoredMessages(): AgentJobMessage[] {
	return messages;
}

export function getStoredIterations(): AgentJobIteration[] {
	return iterations;
}

export function getStoredWorkflowStages(): Array<{
	featureId: string;
	stageCode: string;
}> {
	return workflowStageUpdates;
}

export function getStoredClientConstitutions(): Map<
	string,
	ClientConstitution
> {
	return clientConstitutions;
}

export function getSpecJobCreations(): typeof specJobCreations {
	return specJobCreations;
}
