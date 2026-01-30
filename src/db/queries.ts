import { hostname } from "node:os";
import type { Database, Json } from "../types/supabase.js";
import { supabase } from "./client.js";
import type {
	AgentJob,
	AgentJobInsert,
	AgentJobIteration,
	AgentJobIterationInsert,
	AgentJobIterationUpdate,
	AgentJobMessage,
	AgentJobUpdate,
	ClientWithRepositories,
	CodeBranchInsert,
	CodePullRequestInsert,
	CodeRepository,
	JobWithDetails,
	Prd,
	PrdProgress,
	SpecOutput,
	SpecPhase,
} from "./types.js";

// Machine identifier for distributed job processing
// Each machine only processes jobs assigned to it
export const MACHINE_ID = process.env.MACHINE_ID || hostname();

// ----- Repositories -----

export async function getRepositoryByClientId(
	clientId: string,
): Promise<CodeRepository | null> {
	const { data } = await supabase
		.from("code_repositories")
		.select("*")
		.eq("client_id", clientId)
		.eq("provider", "github")
		.limit(1)
		.single();

	return data;
}

export async function getRepositoryById(
	id: string,
): Promise<CodeRepository | null> {
	const { data } = await supabase
		.from("code_repositories")
		.select("*")
		.eq("id", id)
		.single();

	return data;
}

export async function getRepositoryByGitHub(
	ownerName: string,
	repoName: string,
): Promise<CodeRepository | null> {
	const { data } = await supabase
		.from("code_repositories")
		.select("*")
		.eq("owner_name", ownerName)
		.eq("repo_name", repoName)
		.limit(1)
		.single();

	return data;
}

export async function createRepository(repo: {
	clientId: string;
	ownerName: string;
	repoName: string;
	defaultBranch?: string;
}): Promise<CodeRepository> {
	const { data, error } = await supabase
		.from("code_repositories")
		.insert({
			client_id: repo.clientId,
			provider: "github",
			owner_name: repo.ownerName,
			repo_name: repo.repoName,
			default_branch: repo.defaultBranch || "main",
			url: `https://github.com/${repo.ownerName}/${repo.repoName}`,
		})
		.select()
		.single();

	if (error) throw error;
	return data;
}

// ----- Jobs -----

export async function getJob(id: string): Promise<AgentJob | null> {
	const { data } = await supabase
		.from("agent_jobs")
		.select("*")
		.eq("id", id)
		.single();

	return data;
}

export async function getJobWithDetails(
	id: string,
): Promise<JobWithDetails | null> {
	const { data } = await supabase
		.from("agent_jobs")
		.select(`
      *,
      client:clients(id, name),
      feature:features(id, title),
      repository:code_repositories(id, owner_name, repo_name, default_branch)
    `)
		.eq("id", id)
		.single();

	return data as JobWithDetails | null;
}

export async function listJobs(filters?: {
	status?: string[];
	clientId?: string;
	featureId?: string;
	limit?: number;
	offset?: number;
}): Promise<{ jobs: JobWithDetails[]; total: number }> {
	let query = supabase
		.from("agent_jobs")
		.select(
			`
      *,
      client:clients(id, name),
      feature:features(id, title),
      repository:code_repositories(id, owner_name, repo_name)
    `,
			{ count: "exact" },
		)
		.order("created_at", { ascending: false });

	if (filters?.status?.length) {
		query = query.in("status", filters.status);
	}
	if (filters?.clientId) {
		query = query.eq("client_id", filters.clientId);
	}
	if (filters?.featureId) {
		query = query.eq("feature_id", filters.featureId);
	}

	const limit = filters?.limit || 50;
	const offset = filters?.offset || 0;
	query = query.range(offset, offset + limit - 1);

	const { data, count } = await query;
	return { jobs: (data as JobWithDetails[]) || [], total: count || 0 };
}

export async function getQueuedJobs(): Promise<AgentJob[]> {
	const { data } = await supabase
		.from("agent_jobs")
		.select("*")
		.eq("status", "queued")
		.eq("target_machine", MACHINE_ID)
		.order("created_at", { ascending: true });

	return data || [];
}

export async function getRunningJobs(): Promise<AgentJob[]> {
	const { data } = await supabase
		.from("agent_jobs")
		.select("*")
		.eq("status", "running")
		.eq("target_machine", MACHINE_ID);

	return data || [];
}

export async function getJobsByStatus(
	status: AgentJob["status"],
): Promise<AgentJob[]> {
	const { data } = await supabase
		.from("agent_jobs")
		.select("*")
		.eq("status", status)
		.order("created_at", { ascending: true });

	return data || [];
}

export async function createJob(job: {
	clientId: string;
	featureId?: string;
	repositoryId?: string;
	prompt: string;
	branchName: string;
	title?: string;
	jobType?: string;
	createdByTeamMemberId?: string;
	// Ralph-specific fields
	maxIterations?: number;
	completionPromise?: string;
	feedbackCommands?: string[];
	// PRD mode fields
	prdMode?: boolean;
	prd?: Prd;
	// Spec mode fields - full spec output for runRalphSpecJob
	specOutput?: SpecOutput;
}): Promise<AgentJob> {
	const insert: AgentJobInsert = {
		client_id: job.clientId,
		feature_id: job.featureId,
		repository_id: job.repositoryId,
		prompt: job.prompt,
		branch_name: job.branchName,
		title: job.title,
		job_type: job.jobType,
		created_by_team_member_id: job.createdByTeamMemberId,
		status: "queued",
		// Machine assignment for distributed processing
		target_machine: MACHINE_ID,
		// Ralph-specific fields
		max_iterations: job.maxIterations,
		completion_promise: job.completionPromise,
		feedback_commands: job.feedbackCommands,
		// PRD mode fields
		prd_mode: job.prdMode,
		prd: job.prd ? JSON.parse(JSON.stringify(job.prd)) : undefined,
		prd_progress: job.prdMode
			? JSON.parse(
					JSON.stringify({
						currentStoryId: null,
						completedStoryIds: [],
						commits: [],
					} as PrdProgress),
				)
			: undefined,
		// Spec mode - store specMode flag for queue routing
		spec_output: job.specOutput
			? JSON.parse(JSON.stringify(job.specOutput))
			: undefined,
	};

	const { data, error } = await supabase
		.from("agent_jobs")
		.insert(insert)
		.select()
		.single();

	if (error) throw error;
	return data;
}

export async function updateJob(
	id: string,
	updates: AgentJobUpdate,
): Promise<void> {
	const { error } = await supabase
		.from("agent_jobs")
		.update({ ...updates, updated_at: new Date().toISOString() })
		.eq("id", id);

	if (error) throw error;
}

// ----- Job Messages -----

export async function addJobMessage(
	jobId: string,
	type: "stdout" | "stderr" | "system" | "user_input",
	content: string,
): Promise<void> {
	await supabase
		.from("agent_job_messages")
		.insert({ job_id: jobId, type, content });
}

export async function getJobMessages(
	jobId: string,
): Promise<AgentJobMessage[]> {
	const { data } = await supabase
		.from("agent_job_messages")
		.select("*")
		.eq("job_id", jobId)
		.order("created_at", { ascending: true });

	return data || [];
}

// ----- Branches & PRs -----

export async function createCodeBranch(branch: {
	repositoryId: string;
	featureId?: string;
	name: string;
	url?: string;
}): Promise<{ id: string }> {
	// First check if branch already exists
	const { data: existing } = await supabase
		.from("code_branches")
		.select("id")
		.eq("repository_id", branch.repositoryId)
		.eq("name", branch.name)
		.single();

	if (existing) {
		return existing;
	}

	// Create new branch record
	const insert: CodeBranchInsert = {
		repository_id: branch.repositoryId,
		feature_id: branch.featureId,
		name: branch.name,
		url: branch.url,
	};

	const { data, error } = await supabase
		.from("code_branches")
		.insert(insert)
		.select("id")
		.single();

	if (error) throw error;
	return data;
}

export async function createCodePullRequest(pr: {
	repositoryId: string;
	featureId?: string;
	branchId?: string;
	number: number;
	title: string;
	status?: string;
	url: string;
}): Promise<{ id: string }> {
	// First check if PR already exists by number and repository
	const { data: existing } = await supabase
		.from("code_pull_requests")
		.select("id")
		.eq("repository_id", pr.repositoryId)
		.eq("number", pr.number)
		.single();

	if (existing) {
		return existing;
	}

	// Create new PR record
	const insert: CodePullRequestInsert = {
		repository_id: pr.repositoryId,
		feature_id: pr.featureId,
		branch_id: pr.branchId,
		number: pr.number,
		title: pr.title,
		status: pr.status || "open",
		url: pr.url,
	};

	const { data, error } = await supabase
		.from("code_pull_requests")
		.insert(insert)
		.select("id")
		.single();

	if (error) throw error;
	return data;
}

// ----- Clients -----

export async function getClient(
	id: string,
): Promise<{ id: string; name: string } | null> {
	const { data } = await supabase
		.from("clients")
		.select("id, name")
		.eq("id", id)
		.single();

	return data;
}

export async function listClients(): Promise<ClientWithRepositories[]> {
	const { data } = await supabase
		.from("clients")
		.select(`
      id,
      name,
      repositories:code_repositories(id, owner_name, repo_name, default_branch)
    `)
		.order("name");

	return (data as unknown as ClientWithRepositories[]) || [];
}

export async function listRepositories(): Promise<CodeRepository[]> {
	const { data } = await supabase
		.from("code_repositories")
		.select("*")
		.eq("provider", "github")
		.order("repo_name");

	return data || [];
}

// ----- Job Iterations (Ralph Loop) -----

export async function createIteration(
	jobId: string,
	iterationNumber: number,
): Promise<AgentJobIteration> {
	const insert: AgentJobIterationInsert = {
		job_id: jobId,
		iteration_number: iterationNumber,
		started_at: new Date().toISOString(),
		promise_detected: false,
	};

	const { data, error } = await supabase
		.from("agent_job_iterations")
		.insert(insert)
		.select()
		.single();

	if (error) throw error;
	return data;
}

export async function updateIteration(
	id: string,
	updates: AgentJobIterationUpdate,
): Promise<void> {
	const { error } = await supabase
		.from("agent_job_iterations")
		.update(updates)
		.eq("id", id);

	if (error) throw error;
}

export async function getJobIterations(
	jobId: string,
): Promise<AgentJobIteration[]> {
	const { data } = await supabase
		.from("agent_job_iterations")
		.select("*")
		.eq("job_id", jobId)
		.order("iteration_number", { ascending: true });

	return data || [];
}

// ----- PRD Mode Helpers -----

export async function updatePrdProgress(
	jobId: string,
	progress: PrdProgress,
): Promise<void> {
	const { error } = await supabase
		.from("agent_jobs")
		.update({
			prd_progress: JSON.parse(JSON.stringify(progress)),
			updated_at: new Date().toISOString(),
		})
		.eq("id", jobId);

	if (error) throw error;
}

// ----- Features -----

export interface FeatureWithClient {
	id: string;
	title: string;
	client_id: string;
	functionality_notes: string | null;
	client_context: string | null;
	feature_type_id: string | null;
	client: { id: string; name: string } | null;
}

export async function getFeature(
	featureId: string,
): Promise<FeatureWithClient | null> {
	const { data } = await supabase
		.from("features")
		.select(`
      id,
      title,
      client_id,
      functionality_notes,
      client_context,
      feature_type_id,
      client:clients(id, name)
    `)
		.eq("id", featureId)
		.single();

	return data as FeatureWithClient | null;
}

export async function updateFeaturePrd(
	featureId: string,
	prd: object,
): Promise<void> {
	// Note: prd column added via migration 002_feature_prd.sql
	// Using type assertion for columns not yet in generated types
	const { error } = await supabase
		.from("features")
		.update({
			prd: JSON.parse(JSON.stringify(prd)),
			updated_at: new Date().toISOString(),
		} as unknown as Database["public"]["Tables"]["features"]["Update"])
		.eq("id", featureId);

	if (error) throw error;
}

// ----- Todos -----

export interface TodoInsert {
	feature_id: string;
	title: string;
	description?: string;
	status?: string;
	order_index?: number;
}

export async function createTodos(
	todos: TodoInsert[],
): Promise<{ id: string }[]> {
	const { data, error } = await supabase
		.from("todos")
		.insert(
			todos.map((t) => ({
				feature_id: t.feature_id,
				title: t.title,
				description: t.description,
				status: t.status || "pending",
				order_index: t.order_index,
			})),
		)
		.select("id");

	if (error) throw error;
	return data || [];
}

export async function deleteTodosByFeatureId(
	featureId: string,
): Promise<number> {
	const { data, error } = await supabase
		.from("todos")
		.delete()
		.eq("feature_id", featureId)
		.select("id");

	if (error) throw error;
	return data?.length || 0;
}

export async function getTodosByFeatureId(featureId: string): Promise<
	{
		id: string;
		title: string;
		description: string | null;
		status: string;
		order_index: number | null;
	}[]
> {
	const { data, error } = await supabase
		.from("todos")
		.select("id, title, description, status, order_index")
		.eq("feature_id", featureId)
		.order("order_index", { ascending: true });

	if (error) throw error;
	return data || [];
}

export async function updateTodoStatus(
	todoId: string,
	status: string,
): Promise<void> {
	const { error } = await supabase
		.from("todos")
		.update({
			status,
			updated_at: new Date().toISOString(),
		})
		.eq("id", todoId);

	if (error) throw error;
}

export async function updateTodoStatusByFeatureAndOrder(
	featureId: string,
	orderIndex: number,
	status: string,
): Promise<void> {
	const { error } = await supabase
		.from("todos")
		.update({
			status,
			updated_at: new Date().toISOString(),
		})
		.eq("feature_id", featureId)
		.eq("order_index", orderIndex);

	if (error) throw error;
}

// Sync all todos from PRD stories at end of Ralph job
// Converts 1-indexed story IDs to 0-indexed order_index
export async function syncTodosFromPrd(
	featureId: string,
	stories: { id: number; passes: boolean }[],
): Promise<{ updated: number }> {
	let updated = 0;
	for (const story of stories) {
		const orderIndex = story.id - 1; // Convert 1-indexed story ID to 0-indexed order_index
		const status = story.passes ? "done" : "pending";

		const { error, data } = await supabase
			.from("todos")
			.update({
				status,
				updated_at: new Date().toISOString(),
			})
			.eq("feature_id", featureId)
			.eq("order_index", orderIndex)
			.select("id");

		if (error) throw error;
		if (data && data.length > 0) updated++;
	}
	return { updated };
}

// Get feature with PRD and todos for Ralph job integration
export interface FeatureWithPrdAndTodos {
	id: string;
	title: string;
	client_id: string;
	functionality_notes: string | null;
	client_context: string | null;
	prd: object | null;
	feature_type_id: string | null;
	client: { id: string; name: string } | null;
	todos: {
		id: string;
		title: string;
		description: string | null;
		status: string;
		order_index: number | null;
	}[];
}

export async function getFeatureWithPrdAndTodos(
	featureId: string,
): Promise<FeatureWithPrdAndTodos | null> {
	// Note: prd column added via migration 002_feature_prd.sql
	// TypeScript types may not include it yet, so we cast the result
	const { data: feature } = (await supabase
		.from("features")
		.select(`
      id,
      title,
      client_id,
      functionality_notes,
      client_context,
      prd,
      feature_type_id,
      client:clients(id, name)
    `)
		.eq("id", featureId)
		.single()) as {
		data: {
			id: string;
			title: string;
			client_id: string;
			functionality_notes: string | null;
			client_context: string | null;
			prd: object | null;
			feature_type_id: string | null;
			client: { id: string; name: string } | null;
		} | null;
	};

	if (!feature) return null;

	const todos = await getTodosByFeatureId(featureId);

	return {
		...feature,
		todos,
	};
}

// Update feature workflow stage
export async function updateFeatureWorkflowStage(
	featureId: string,
	workflowStageId: string,
): Promise<void> {
	const { error } = await supabase
		.from("features")
		.update({
			feature_workflow_stage_id: workflowStageId,
			updated_at: new Date().toISOString(),
		})
		.eq("id", featureId);

	if (error) throw error;
}

// ----- Comments -----

export async function createComment(data: {
	parentType: string;
	parentId: string;
	body: string;
	createdByTeamId?: string;
}): Promise<{ id: string }> {
	const { data: comment, error } = await supabase
		.from("comments")
		.insert({
			parent_type: data.parentType,
			parent_id: data.parentId,
			body: data.body,
			created_by_team_id:
				data.createdByTeamId || "0403861c-c451-4235-848d-7dbaa0b0e963",
		})
		.select("id")
		.single();

	if (error) throw error;
	return comment;
}

// ----- Client Tools -----

export async function getClientToolByType(
	clientId: string,
	toolType: string,
): Promise<{ external_id: string | null; metadata: unknown } | null> {
	const { data, error } = await supabase
		.from("client_tools")
		.select("external_id, metadata")
		.eq("client_id", clientId)
		.eq("tool_type", toolType)
		.single();

	if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
	return data;
}

// ----- Spec-Kit -----

// Get feature's spec output
export async function getFeatureSpecOutput(
	featureId: string,
): Promise<SpecOutput | null> {
	const { data, error } = await supabase
		.from("features")
		.select("spec_output")
		.eq("id", featureId)
		.single();

	if (error && error.code !== "PGRST116") throw error;
	return data?.spec_output as SpecOutput | null;
}

// Update feature's spec output
export async function updateFeatureSpecOutput(
	featureId: string,
	specOutput: SpecOutput,
): Promise<void> {
	// spec_output and spec_phase columns added via migration 003_spec_kit.sql
	const { error } = await supabase
		.from("features")
		.update({
			spec_output: JSON.parse(JSON.stringify(specOutput)),
			spec_phase: specOutput.phase,
			updated_at: new Date().toISOString(),
		} as unknown as Database["public"]["Tables"]["features"]["Update"])
		.eq("id", featureId);

	if (error) throw error;
}

// Update feature's spec phase only
export async function updateFeatureSpecPhase(
	featureId: string,
	phase: SpecPhase,
): Promise<void> {
	// spec_phase column added via migration 003_spec_kit.sql
	const { error } = await supabase
		.from("features")
		.update({
			spec_phase: phase,
			updated_at: new Date().toISOString(),
		} as unknown as Database["public"]["Tables"]["features"]["Update"])
		.eq("id", featureId);

	if (error) throw error;
}

// Create a spec job
export async function createSpecJob(params: {
	clientId: string;
	featureId: string | null;
	repositoryId?: string;
	specPhase: SpecPhase;
	createdByTeamMemberId?: string;
	specOutput?: Record<string, unknown>;
}): Promise<AgentJob> {
	// Generate branch name based on featureId or clientId
	const branchSlug = params.featureId
		? `spec-${params.featureId.slice(0, 8)}`
		: `constitution-${params.clientId.slice(0, 8)}`;

	const insert: AgentJobInsert = {
		client_id: params.clientId,
		feature_id: params.featureId,
		repository_id: params.repositoryId,
		prompt: `Run Spec-Kit phase: ${params.specPhase}`,
		branch_name: `${branchSlug}-${Date.now()}`,
		title: `Spec-Kit: ${params.specPhase}`,
		job_type: "spec",
		spec_phase: params.specPhase,
		spec_output: params.specOutput
			? (params.specOutput as unknown as Json)
			: null,
		created_by_team_member_id: params.createdByTeamMemberId,
		status: "queued",
		target_machine: MACHINE_ID,
	};

	const { data, error } = await supabase
		.from("agent_jobs")
		.insert(insert)
		.select()
		.single();

	if (error) throw error;
	return data;
}

// Get spec jobs for a feature
export async function getSpecJobsForFeature(
	featureId: string,
): Promise<AgentJob[]> {
	const { data, error } = await supabase
		.from("agent_jobs")
		.select("*")
		.eq("feature_id", featureId)
		.eq("job_type", "spec")
		.order("created_at", { ascending: false });

	if (error) throw error;
	return data || [];
}

// Get all client tools of a specific type (e.g., multiple Vercel projects)
export async function getClientToolsByType(
	clientId: string,
	toolType: string,
): Promise<{ external_id: string | null; metadata: unknown }[]> {
	const { data, error } = await supabase
		.from("client_tools")
		.select("external_id, metadata")
		.eq("client_id", clientId)
		.eq("tool_type", toolType);

	if (error) throw error;
	return data || [];
}

// ----- Client Constitution -----

export interface ClientConstitution {
	constitution: string;
	generatedAt: string;
}

// Get client's constitution (if exists)
export async function getClientConstitution(
	clientId: string,
): Promise<ClientConstitution | null> {
	// constitution and constitution_generated_at columns added via migration 0012
	// These columns won't be in generated types until types are regenerated
	const { data, error } = await supabase
		.from("clients")
		.select("*")
		.eq("id", clientId)
		.single();

	if (error && error.code !== "PGRST116") throw error;
	if (!data) return null;

	// Type assertion since columns may not be in generated types yet
	const clientData = data as unknown as {
		constitution: string | null;
		constitution_generated_at: string | null;
	};

	if (!clientData.constitution) return null;

	return {
		constitution: clientData.constitution,
		generatedAt:
			clientData.constitution_generated_at || new Date().toISOString(),
	};
}

// ----- Attachments -----

export interface AttachmentInsert {
	entityType: string;
	entityId: string;
	fileName: string;
	fileSize: number;
	mimeType: string;
	storagePath: string;
	url: string;
}

export interface Attachment {
	id: string;
	entity_type: string;
	entity_id: string;
	file_name: string | null;
	mime_type: string | null;
	storage_path: string | null;
	url: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string | null;
}

export async function createAttachment(
	data: AttachmentInsert,
): Promise<{ id: string; url: string | null }> {
	const { data: attachment, error } = await supabase
		.from("attachments")
		.insert({
			entity_type: data.entityType,
			entity_id: data.entityId,
			file_name: data.fileName,
			mime_type: data.mimeType,
			storage_path: data.storagePath,
			url: data.url,
			metadata: { fileSize: data.fileSize } as unknown as Json,
		})
		.select("id, url")
		.single();

	if (error) throw error;
	return attachment;
}

export async function getAttachmentsByEntity(
	entityType: string,
	entityId: string,
): Promise<Attachment[]> {
	const { data, error } = await supabase
		.from("attachments")
		.select("*")
		.eq("entity_type", entityType)
		.eq("entity_id", entityId)
		.order("created_at", { ascending: false });

	if (error) throw error;
	return (data as unknown as Attachment[]) || [];
}

// ----- Storage -----

export async function uploadToStorage(
	bucket: string,
	path: string,
	file: Buffer,
	contentType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
	const { error } = await supabase.storage.from(bucket).upload(path, file, {
		contentType,
		upsert: true,
	});

	if (error) throw error;

	const {
		data: { publicUrl },
	} = supabase.storage.from(bucket).getPublicUrl(path);

	return { storagePath: path, publicUrl };
}

// Update client's constitution
export async function updateClientConstitution(
	clientId: string,
	constitution: string,
): Promise<void> {
	// constitution and constitution_generated_at columns added via migration 0012
	const { error } = await supabase
		.from("clients")
		.update({
			constitution,
			constitution_generated_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		} as unknown as Database["public"]["Tables"]["clients"]["Update"])
		.eq("id", clientId);

	if (error) throw error;
}

// ----- Workflow Stage Management -----

// Feature workflow ID (from OS migrations)
const FEATURE_WORKFLOW_ID = "e787fde9-4d77-46ca-a032-33bd78c4bd91";

// Spec-Kit phase stage codes (from 0013_spec_kit_ralph_workflow_stages.sql)
export const SPEC_STAGE_CODES = {
	// Constitution
	constitution_running: "constitution_running", // 51
	constitution_complete: "constitution_complete", // 52

	// Specify
	specify_running: "specify_running", // 55
	specify_clarify: "specify_clarify", // 56
	specify_dev_review: "specify_dev_review", // 58
	specify_ba_review: "specify_ba_review", // 59
	specify_complete: "specify_complete", // 60

	// Clarify
	clarify_running: "clarify_running", // 61
	clarify_waiting: "clarify_waiting", // 62
	clarify_complete: "clarify_complete", // 63

	// Plan
	plan_running: "plan_running", // 65
	plan_clarify: "plan_clarify", // 66
	plan_dev_review: "plan_dev_review", // 68
	plan_ba_review: "plan_ba_review", // 69
	plan_complete: "plan_complete", // 64

	// Analyze
	analyze_running: "analyze_running", // 71
	analyze_failed: "analyze_failed", // 72
	analyze_complete: "analyze_complete", // 73

	// Improve
	improve_running: "improve_running", // 75
	improve_clarify: "improve_clarify", // 76
	improve_complete: "improve_complete", // 77

	// Tasks
	tasks_running: "tasks_running", // 81
	tasks_clarify: "tasks_clarify", // 82
	tasks_complete: "tasks_complete", // 83

	// Spec done
	spec_complete: "spec_complete", // 84
} as const;

// Ralph stage codes
export const RALPH_STAGE_CODES = {
	ralph_running: "ralph_running", // 135
	ralph_clarify: "ralph_clarify", // 136
	ralph_dev_review: "ralph_dev_review", // 138
	ralph_ba_review: "ralph_ba_review", // 139
	ralph_complete: "screen_validation", // 300
} as const;

export type SpecStageCode =
	(typeof SPEC_STAGE_CODES)[keyof typeof SPEC_STAGE_CODES];
export type RalphStageCode =
	(typeof RALPH_STAGE_CODES)[keyof typeof RALPH_STAGE_CODES];

// Cache for stage code → ID lookups
const stageCodeCache = new Map<string, string>();

// Look up workflow stage ID by code
export async function getWorkflowStageByCode(
	stageCode: string,
): Promise<string | null> {
	// Check cache first
	const cached = stageCodeCache.get(stageCode);
	if (cached) return cached;

	const { data, error } = await supabase
		.from("workflow_stages")
		.select("id")
		.eq("code", stageCode)
		.eq("workflow_id", FEATURE_WORKFLOW_ID)
		.single();

	if (error && error.code !== "PGRST116") {
		console.error(`Failed to lookup stage code ${stageCode}:`, error);
		return null;
	}

	if (data?.id) {
		stageCodeCache.set(stageCode, data.id);
		return data.id;
	}

	return null;
}

// Update feature workflow stage by code (convenience wrapper)
export async function updateFeatureWorkflowStageByCode(
	featureId: string,
	stageCode: string,
): Promise<boolean> {
	const stageId = await getWorkflowStageByCode(stageCode);
	if (!stageId) {
		console.error(`Stage code not found: ${stageCode}`);
		return false;
	}

	await updateFeatureWorkflowStage(featureId, stageId);
	return true;
}
