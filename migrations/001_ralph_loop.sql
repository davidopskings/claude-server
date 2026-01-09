-- Ralph Wiggum Loop: Database Migration
-- Run this in Supabase SQL Editor

-- 1. Add new columns to agent_jobs table
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS max_iterations integer DEFAULT 10;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS completion_promise text DEFAULT 'RALPH_COMPLETE';
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS current_iteration integer DEFAULT 0;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS total_iterations integer;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS completion_reason text;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS feedback_commands jsonb;

-- 2. Create agent_job_iterations table
CREATE TABLE IF NOT EXISTS agent_job_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  iteration_number integer NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  exit_code integer,
  error text,
  pid integer,
  prompt_used text,
  promise_detected boolean DEFAULT false,
  output_summary text,
  feedback_results jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(job_id, iteration_number)
);

-- 3. Create index for faster iteration lookups
CREATE INDEX IF NOT EXISTS idx_job_iterations_job_id ON agent_job_iterations(job_id);

-- 4. Add comment for documentation
COMMENT ON TABLE agent_job_iterations IS 'Tracks individual iterations within Ralph loop jobs';
COMMENT ON COLUMN agent_jobs.max_iterations IS 'Maximum iterations for ralph jobs (default 10)';
COMMENT ON COLUMN agent_jobs.completion_promise IS 'String that signals completion (default RALPH_COMPLETE)';
COMMENT ON COLUMN agent_jobs.current_iteration IS 'Current iteration number for running ralph jobs';
COMMENT ON COLUMN agent_jobs.total_iterations IS 'Final iteration count when job completes';
COMMENT ON COLUMN agent_jobs.completion_reason IS 'Why ralph job ended: promise_detected, max_iterations, manual_stop, iteration_error';
COMMENT ON COLUMN agent_jobs.feedback_commands IS 'JSON array of commands to run between iterations';
