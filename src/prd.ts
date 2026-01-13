import { spawn } from 'child_process';
import { getFeature, updateFeaturePrd, createTodos, deleteTodosByFeatureId, type FeatureWithClient, type TodoInsert } from './db/index.js';

const HOME_DIR = process.env.HOME || '/Users/davidcavarlacic';
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${HOME_DIR}/.local/bin/claude`;

// PRD structure based on ai-dev-tasks pattern
export interface GeneratedPrd {
  title: string;
  overview: string;
  goals: string[];
  userStories: string[];
  functionalRequirements: string[];
  nonGoals: string[];
  technicalConsiderations: string[];
  successMetrics: string[];
}

export interface GeneratedTask {
  title: string;
  description: string;
  orderIndex: number;
}

export interface PrdGenerationResult {
  featureId: string;
  featureTitle: string;
  prd: GeneratedPrd;
  tasks: GeneratedTask[];
  todosCreated: number;
}

// Prompt for generating PRD - based on ai-dev-tasks create-prd.md
const PRD_PROMPT = `You are a product manager creating a PRD (Product Requirements Document) for a development feature.

Based on the feature information provided, generate a comprehensive PRD in JSON format.

IMPORTANT: Your response must be ONLY valid JSON, no markdown, no explanation, just the JSON object.

The JSON structure must be:
{
  "title": "Feature title",
  "overview": "Brief 2-3 sentence description of what this feature does and why it matters",
  "goals": ["Goal 1", "Goal 2", ...],
  "userStories": ["As a [user], I want to [action] so that [benefit]", ...],
  "functionalRequirements": ["Requirement 1", "Requirement 2", ...],
  "nonGoals": ["What this feature will NOT do", ...],
  "technicalConsiderations": ["Technical note 1", ...],
  "successMetrics": ["How to measure success", ...]
}

Guidelines:
- Write for junior developers - be explicit and unambiguous
- Goals should be measurable outcomes
- User stories should follow the standard format
- Functional requirements should be specific and testable
- Non-goals help define scope boundaries
- Technical considerations should inform implementation approach
- Success metrics should be quantifiable where possible

Feature Information:
`;

// Prompt for generating tasks - based on ai-dev-tasks generate-tasks.md
const TASKS_PROMPT = `You are a technical lead breaking down a PRD into implementation tasks.

Based on the PRD provided, generate a detailed task list in JSON format.

IMPORTANT: Your response must be ONLY valid JSON, no markdown, no explanation, just the JSON array.

The JSON structure must be an array of tasks:
[
  {
    "title": "Short task title (5-10 words)",
    "description": "Detailed description with implementation guidance for a junior developer",
    "orderIndex": 1
  },
  ...
]

Guidelines:
- Start with "Create feature branch" as task 0
- Break down into granular, actionable sub-tasks
- Each task should be completable in 1-4 hours
- Target junior developers - include implementation hints
- Order tasks logically (dependencies first)
- Include testing tasks where appropriate
- Aim for 5-15 tasks depending on complexity

PRD:
`;

async function runClaudeForPrd(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';

    const proc = spawn(CLAUDE_BIN, [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'text',
      prompt
    ], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: HOME_DIR },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${errorOutput}`));
      } else {
        resolve(output.trim());
      }
    });

    proc.on('error', (err: Error) => {
      reject(err);
    });
  });
}

function extractJson(text: string): string {
  // Try to extract JSON from the response, handling markdown code blocks
  let jsonStr = text.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }

  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  return jsonStr.trim();
}

function buildFeatureContext(feature: FeatureWithClient): string {
  const parts: string[] = [];

  parts.push(`Title: ${feature.title}`);

  if (feature.client?.name) {
    parts.push(`Client: ${feature.client.name}`);
  }

  if (feature.functionality_notes) {
    parts.push(`\nFunctionality Notes:\n${feature.functionality_notes}`);
  }

  if (feature.client_context) {
    parts.push(`\nClient Context:\n${feature.client_context}`);
  }

  return parts.join('\n');
}

export async function generateFeaturePrd(
  featureId: string,
  options: { clearExisting?: boolean } = {}
): Promise<PrdGenerationResult> {
  // 1. Get feature from database
  const feature = await getFeature(featureId);
  if (!feature) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  const featureContext = buildFeatureContext(feature);
  console.log(`Generating PRD for feature: ${feature.title}`);

  // 2. Generate PRD using Claude
  const prdPrompt = PRD_PROMPT + featureContext;
  console.log('Calling Claude for PRD generation...');
  const prdResponse = await runClaudeForPrd(prdPrompt);

  let prd: GeneratedPrd;
  try {
    const jsonStr = extractJson(prdResponse);
    prd = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse PRD response as JSON: ${err}. Response was: ${prdResponse.slice(0, 500)}`);
  }

  // 3. Generate tasks using Claude
  const tasksPrompt = TASKS_PROMPT + JSON.stringify(prd, null, 2);
  console.log('Calling Claude for task generation...');
  const tasksResponse = await runClaudeForPrd(tasksPrompt);

  let tasks: GeneratedTask[];
  try {
    const jsonStr = extractJson(tasksResponse);
    tasks = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse tasks response as JSON: ${err}. Response was: ${tasksResponse.slice(0, 500)}`);
  }

  // 4. Clear existing todos if requested
  if (options.clearExisting) {
    const deleted = await deleteTodosByFeatureId(featureId);
    console.log(`Deleted ${deleted} existing todos`);
  }

  // 5. Save PRD to feature record
  await updateFeaturePrd(featureId, prd);
  console.log('Saved PRD to feature record');

  // 6. Create todos in database
  const todoInserts: TodoInsert[] = tasks.map(task => ({
    feature_id: featureId,
    title: task.title,
    description: task.description,
    status: 'pending',
    order_index: task.orderIndex
  }));

  const createdTodos = await createTodos(todoInserts);
  console.log(`Created ${createdTodos.length} todos`);

  return {
    featureId,
    featureTitle: feature.title,
    prd,
    tasks,
    todosCreated: createdTodos.length
  };
}
