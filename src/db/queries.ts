import { supabase } from './client.js';
import type {
  AgentJob,
  AgentJobInsert,
  AgentJobUpdate,
  AgentJobMessage,
  AgentJobIteration,
  AgentJobIterationInsert,
  AgentJobIterationUpdate,
  CodeRepository,
  CodeBranchInsert,
  CodePullRequestInsert,
  JobWithDetails,
  ClientWithRepositories,
  Prd,
  PrdProgress,
  PrdCommit
} from './types.js';

// ----- Repositories -----

export async function getRepositoryByClientId(clientId: string): Promise<CodeRepository | null> {
  const { data } = await supabase
    .from('code_repositories')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', 'github')
    .limit(1)
    .single();

  return data;
}

export async function getRepositoryById(id: string): Promise<CodeRepository | null> {
  const { data } = await supabase
    .from('code_repositories')
    .select('*')
    .eq('id', id)
    .single();

  return data;
}

export async function getRepositoryByGitHub(
  ownerName: string,
  repoName: string
): Promise<CodeRepository | null> {
  const { data } = await supabase
    .from('code_repositories')
    .select('*')
    .eq('owner_name', ownerName)
    .eq('repo_name', repoName)
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
    .from('code_repositories')
    .insert({
      client_id: repo.clientId,
      provider: 'github',
      owner_name: repo.ownerName,
      repo_name: repo.repoName,
      default_branch: repo.defaultBranch || 'main',
      url: `https://github.com/${repo.ownerName}/${repo.repoName}`
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ----- Jobs -----

export async function getJob(id: string): Promise<AgentJob | null> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('id', id)
    .single();

  return data;
}

export async function getJobWithDetails(id: string): Promise<JobWithDetails | null> {
  const { data } = await supabase
    .from('agent_jobs')
    .select(`
      *,
      client:clients(id, name),
      feature:features(id, title),
      repository:code_repositories(id, owner_name, repo_name, default_branch)
    `)
    .eq('id', id)
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
    .from('agent_jobs')
    .select(`
      *,
      client:clients(id, name),
      feature:features(id, title),
      repository:code_repositories(id, owner_name, repo_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false });

  if (filters?.status?.length) {
    query = query.in('status', filters.status);
  }
  if (filters?.clientId) {
    query = query.eq('client_id', filters.clientId);
  }
  if (filters?.featureId) {
    query = query.eq('feature_id', filters.featureId);
  }

  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, count } = await query;
  return { jobs: (data as JobWithDetails[]) || [], total: count || 0 };
}

export async function getQueuedJobs(): Promise<AgentJob[]> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  return data || [];
}

export async function getRunningJobs(): Promise<AgentJob[]> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('status', 'running');

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
    status: 'queued',
    // Ralph-specific fields
    max_iterations: job.maxIterations,
    completion_promise: job.completionPromise,
    feedback_commands: job.feedbackCommands,
    // PRD mode fields
    prd_mode: job.prdMode,
    prd: job.prd ? JSON.parse(JSON.stringify(job.prd)) : undefined,
    prd_progress: job.prdMode ? JSON.parse(JSON.stringify({
      currentStoryId: null,
      completedStoryIds: [],
      commits: []
    } as PrdProgress)) : undefined
  };

  const { data, error } = await supabase
    .from('agent_jobs')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateJob(id: string, updates: AgentJobUpdate): Promise<void> {
  const { error } = await supabase
    .from('agent_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

// ----- Job Messages -----

export async function addJobMessage(
  jobId: string,
  type: 'stdout' | 'stderr' | 'system' | 'user_input',
  content: string
): Promise<void> {
  await supabase
    .from('agent_job_messages')
    .insert({ job_id: jobId, type, content });
}

export async function getJobMessages(jobId: string): Promise<AgentJobMessage[]> {
  const { data } = await supabase
    .from('agent_job_messages')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  return data || [];
}

// ----- Branches & PRs -----

export async function createCodeBranch(branch: {
  repositoryId: string;
  featureId?: string;
  name: string;
  url?: string;
}): Promise<{ id: string }> {
  const insert: CodeBranchInsert = {
    repository_id: branch.repositoryId,
    feature_id: branch.featureId,
    name: branch.name,
    url: branch.url
  };

  const { data, error } = await supabase
    .from('code_branches')
    .insert(insert)
    .select('id')
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
  const insert: CodePullRequestInsert = {
    repository_id: pr.repositoryId,
    feature_id: pr.featureId,
    branch_id: pr.branchId,
    number: pr.number,
    title: pr.title,
    status: pr.status || 'open',
    url: pr.url
  };

  const { data, error } = await supabase
    .from('code_pull_requests')
    .insert(insert)
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

// ----- Clients -----

export async function getClient(id: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', id)
    .single();

  return data;
}

export async function listClients(): Promise<ClientWithRepositories[]> {
  const { data } = await supabase
    .from('clients')
    .select(`
      id,
      name,
      repositories:code_repositories(id, owner_name, repo_name, default_branch)
    `)
    .order('name');

  return (data as unknown as ClientWithRepositories[]) || [];
}

export async function listRepositories(): Promise<CodeRepository[]> {
  const { data } = await supabase
    .from('code_repositories')
    .select('*')
    .eq('provider', 'github')
    .order('repo_name');

  return data || [];
}

// ----- Job Iterations (Ralph Loop) -----

export async function createIteration(
  jobId: string,
  iterationNumber: number
): Promise<AgentJobIteration> {
  const insert: AgentJobIterationInsert = {
    job_id: jobId,
    iteration_number: iterationNumber,
    started_at: new Date().toISOString(),
    promise_detected: false
  };

  const { data, error } = await supabase
    .from('agent_job_iterations')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateIteration(
  id: string,
  updates: AgentJobIterationUpdate
): Promise<void> {
  const { error } = await supabase
    .from('agent_job_iterations')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function getJobIterations(jobId: string): Promise<AgentJobIteration[]> {
  const { data } = await supabase
    .from('agent_job_iterations')
    .select('*')
    .eq('job_id', jobId)
    .order('iteration_number', { ascending: true });

  return data || [];
}

// ----- PRD Mode Helpers -----

export async function updatePrdProgress(
  jobId: string,
  progress: PrdProgress
): Promise<void> {
  const { error } = await supabase
    .from('agent_jobs')
    .update({
      prd_progress: JSON.parse(JSON.stringify(progress)),
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);

  if (error) throw error;
}

// ----- Features -----

export interface FeatureWithClient {
  id: string;
  title: string;
  client_id: string;
  functionality_notes: string | null;
  client_context: string | null;
  client: { id: string; name: string } | null;
}

export async function getFeature(featureId: string): Promise<FeatureWithClient | null> {
  const { data } = await supabase
    .from('features')
    .select(`
      id,
      title,
      client_id,
      functionality_notes,
      client_context,
      client:clients(id, name)
    `)
    .eq('id', featureId)
    .single();

  return data as FeatureWithClient | null;
}

export async function updateFeaturePrd(
  featureId: string,
  prd: object
): Promise<void> {
  // Note: prd column added via migration 002_feature_prd.sql
  const { error } = await supabase
    .from('features')
    .update({
      prd: JSON.parse(JSON.stringify(prd)),
      updated_at: new Date().toISOString()
    } as any)
    .eq('id', featureId);

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

export async function createTodos(todos: TodoInsert[]): Promise<{ id: string }[]> {
  const { data, error } = await supabase
    .from('todos')
    .insert(todos.map(t => ({
      feature_id: t.feature_id,
      title: t.title,
      description: t.description,
      status: t.status || 'pending',
      order_index: t.order_index
    })))
    .select('id');

  if (error) throw error;
  return data || [];
}

export async function deleteTodosByFeatureId(featureId: string): Promise<number> {
  const { data, error } = await supabase
    .from('todos')
    .delete()
    .eq('feature_id', featureId)
    .select('id');

  if (error) throw error;
  return data?.length || 0;
}

export async function getTodosByFeatureId(featureId: string): Promise<{
  id: string;
  title: string;
  description: string | null;
  status: string;
  order_index: number | null;
}[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('id, title, description, status, order_index')
    .eq('feature_id', featureId)
    .order('order_index', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function updateTodoStatus(
  todoId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from('todos')
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', todoId);

  if (error) throw error;
}

export async function updateTodoStatusByFeatureAndOrder(
  featureId: string,
  orderIndex: number,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from('todos')
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('feature_id', featureId)
    .eq('order_index', orderIndex);

  if (error) throw error;
}

// Sync all todos from PRD stories at end of Ralph job
// Converts 1-indexed story IDs to 0-indexed order_index
export async function syncTodosFromPrd(
  featureId: string,
  stories: { id: number; passes: boolean }[]
): Promise<{ updated: number }> {
  let updated = 0;
  for (const story of stories) {
    const orderIndex = story.id - 1; // Convert 1-indexed story ID to 0-indexed order_index
    const status = story.passes ? 'done' : 'pending';

    const { error, count } = await supabase
      .from('todos')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('feature_id', featureId)
      .eq('order_index', orderIndex);

    if (error) throw error;
    if (count && count > 0) updated++;
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
  client: { id: string; name: string } | null;
  todos: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    order_index: number | null;
  }[];
}

export async function getFeatureWithPrdAndTodos(featureId: string): Promise<FeatureWithPrdAndTodos | null> {
  // Note: prd column added via migration 002_feature_prd.sql
  // TypeScript types may not include it yet, so we cast the result
  const { data: feature } = await supabase
    .from('features')
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
    .eq('id', featureId)
    .single() as { data: {
      id: string;
      title: string;
      client_id: string;
      functionality_notes: string | null;
      client_context: string | null;
      prd: object | null;
      feature_type_id: string | null;
      client: { id: string; name: string } | null;
    } | null };

  if (!feature) return null;

  const todos = await getTodosByFeatureId(featureId);

  return {
    ...feature,
    todos
  };
}

// Update feature workflow stage
export async function updateFeatureWorkflowStage(
  featureId: string,
  workflowStageId: string
): Promise<void> {
  const { error } = await supabase
    .from('features')
    .update({
      feature_workflow_stage_id: workflowStageId,
      updated_at: new Date().toISOString()
    })
    .eq('id', featureId);

  if (error) throw error;
}
