import { supabase } from './client.js';
import type {
  AgentJob,
  AgentJobInsert,
  AgentJobUpdate,
  AgentJobMessage,
  CodeRepository,
  CodeBranchInsert,
  CodePullRequestInsert,
  JobWithDetails,
  ClientWithRepositories
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
    status: 'queued'
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
