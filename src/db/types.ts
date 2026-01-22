import type { Database } from '../types/supabase.js';

// Job types
export type JobType = 'code' | 'task' | 'ralph' | 'prd_generation';

// Ralph-specific types
export type RalphCompletionReason =
  | 'promise_detected'
  | 'max_iterations'
  | 'manual_stop'
  | 'iteration_error'
  | 'all_stories_complete';

export interface FeedbackResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
}

// PRD Mode types
export interface PrdStory {
  id: number;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  passes: boolean;
}

export interface Prd {
  title: string;
  description?: string;
  stories: PrdStory[];
}

export interface PrdProgress {
  currentStoryId: number | null;
  completedStoryIds: number[];
  commits: PrdCommit[];
}

export interface PrdCommit {
  storyId: number;
  sha: string;
  message: string;
  timestamp: string;
}

// Table row types
export type Client = Database['public']['Tables']['clients']['Row'];
export type Feature = Database['public']['Tables']['features']['Row'];
export type CodeRepository = Database['public']['Tables']['code_repositories']['Row'];
export type CodeBranch = Database['public']['Tables']['code_branches']['Row'];
export type CodePullRequest = Database['public']['Tables']['code_pull_requests']['Row'];
export type AgentJob = Database['public']['Tables']['agent_jobs']['Row'];
export type AgentJobMessage = Database['public']['Tables']['agent_job_messages']['Row'];
export type AgentJobIteration = Database['public']['Tables']['agent_job_iterations']['Row'];

// Insert types
export type AgentJobInsert = Database['public']['Tables']['agent_jobs']['Insert'];
export type AgentJobMessageInsert = Database['public']['Tables']['agent_job_messages']['Insert'];
export type AgentJobIterationInsert = Database['public']['Tables']['agent_job_iterations']['Insert'];
export type CodeBranchInsert = Database['public']['Tables']['code_branches']['Insert'];
export type CodePullRequestInsert = Database['public']['Tables']['code_pull_requests']['Insert'];
export type CodeRepositoryInsert = Database['public']['Tables']['code_repositories']['Insert'];

// Update types
export type AgentJobUpdate = Database['public']['Tables']['agent_jobs']['Update'];
export type AgentJobIterationUpdate = Database['public']['Tables']['agent_job_iterations']['Update'];

// Custom query return types (for joins)
export type JobWithDetails = AgentJob & {
  client: Pick<Client, 'id' | 'name'> | null;
  feature: Pick<Feature, 'id' | 'title'> | null;
  repository: Pick<CodeRepository, 'id' | 'owner_name' | 'repo_name' | 'default_branch'> | null;
};

export type ClientWithRepositories = Pick<Client, 'id' | 'name'> & {
  repositories: Pick<CodeRepository, 'id' | 'owner_name' | 'repo_name' | 'default_branch'>[];
};
