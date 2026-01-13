-- Feature PRD Generation: Database Migration
-- Run this in Supabase SQL Editor

-- 1. Add prd column to features table
ALTER TABLE features ADD COLUMN IF NOT EXISTS prd jsonb;

COMMENT ON COLUMN features.prd IS 'Generated PRD document with goals, user stories, requirements, etc.';
