import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';
import type { CodeRepository, AgentJob } from './db/index.js';
import { listRepositories, getRepositoryById } from './db/index.js';

const REPOS_DIR = process.env.REPOS_DIR || `${homedir()}/repos`;
const WORKTREES_DIR = process.env.WORKTREES_DIR || `${homedir()}/worktrees`;

// Ensure directories exist on module load
mkdirSync(REPOS_DIR, { recursive: true });
mkdirSync(WORKTREES_DIR, { recursive: true });

export function bareRepoPath(repo: CodeRepository): string {
  return `${REPOS_DIR}/${repo.repo_name}.git`;
}

export function bareRepoExists(repo: CodeRepository): boolean {
  return existsSync(bareRepoPath(repo));
}

export async function ensureBareRepo(repo: CodeRepository): Promise<string> {
  const barePath = bareRepoPath(repo);

  if (!existsSync(barePath)) {
    console.log(`Cloning bare repository for ${repo.owner_name}/${repo.repo_name}...`);
    execSync(
      `git clone --bare git@github.com:${repo.owner_name}/${repo.repo_name}.git "${barePath}"`,
      { stdio: 'pipe' }
    );
    // Fetch to ensure we have all remote refs including origin/main
    console.log(`Fetching refs for ${repo.repo_name}...`);
    execSync('git fetch origin', { cwd: barePath, stdio: 'pipe' });
    console.log(`Cloned bare repository to ${barePath}`);
  }

  return barePath;
}

export async function fetchOrigin(repo: CodeRepository): Promise<void> {
  const barePath = bareRepoPath(repo);

  if (!existsSync(barePath)) {
    throw new Error(`Bare repository does not exist: ${barePath}`);
  }

  console.log(`Fetching origin for ${repo.repo_name}...`);
  // In bare repos, we need to explicitly update local branches from remote
  execSync('git fetch origin "+refs/heads/*:refs/heads/*" --prune', { cwd: barePath, stdio: 'pipe' });
}

export async function fetchAllRepos(): Promise<{ repo: string; success: boolean; error?: string }[]> {
  const results: { repo: string; success: boolean; error?: string }[] = [];

  if (!existsSync(REPOS_DIR)) {
    return results;
  }

  const entries = execSync(`ls -d "${REPOS_DIR}"/*.git 2>/dev/null || true`, {
    encoding: 'utf-8'
  }).trim();

  if (!entries) return results;

  for (const barePath of entries.split('\n').filter(Boolean)) {
    const repoName = barePath.split('/').pop()?.replace('.git', '') || '';

    try {
      execSync('git fetch origin "+refs/heads/*:refs/heads/*" --prune', { cwd: barePath, stdio: 'pipe' });
      results.push({ repo: repoName, success: true });
    } catch (err: any) {
      results.push({ repo: repoName, success: false, error: err.message });
    }
  }

  return results;
}

export async function createWorktree(
  repo: CodeRepository,
  job: AgentJob
): Promise<string> {
  const barePath = bareRepoPath(repo);
  const worktreePath = `${WORKTREES_DIR}/${repo.repo_name}/${job.id}`;
  const defaultBranch = repo.default_branch || 'main';

  if (!existsSync(barePath)) {
    throw new Error(`Bare repository does not exist: ${barePath}`);
  }

  // Clean up any orphaned worktrees first
  try {
    execSync('git worktree prune', { cwd: barePath, stdio: 'pipe' });
  } catch {
    // Ignore prune errors
  }

  // Create parent directory
  mkdirSync(dirname(worktreePath), { recursive: true });

  console.log(`Creating worktree for job ${job.id} at ${worktreePath}...`);

  // Check if branch already exists
  let branchExists = false;
  try {
    execSync(`git show-ref --verify refs/heads/${job.branch_name}`, {
      cwd: barePath,
      stdio: 'pipe'
    });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    // Check if branch is already checked out in another worktree
    try {
      const worktreeList = execSync('git worktree list --porcelain', {
        cwd: barePath,
        encoding: 'utf-8'
      });

      // Parse worktree list to find if our branch is checked out
      const lines = worktreeList.split('\n');
      let currentWorktreePath: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentWorktreePath = line.substring(9);
        } else if (line.startsWith('branch refs/heads/') && currentWorktreePath) {
          const branchName = line.substring(18);
          if (branchName === job.branch_name) {
            // Branch is checked out elsewhere - remove that worktree first
            console.log(`Branch ${job.branch_name} is checked out at ${currentWorktreePath}, removing...`);
            try {
              execSync(`git worktree remove --force "${currentWorktreePath}"`, {
                cwd: barePath,
                stdio: 'pipe'
              });
            } catch {
              // Force remove the directory if git worktree remove fails
              if (existsSync(currentWorktreePath)) {
                rmSync(currentWorktreePath, { recursive: true, force: true });
              }
              execSync('git worktree prune', { cwd: barePath, stdio: 'pipe' });
            }
            break;
          }
        }
      }
    } catch {
      // Ignore errors checking worktree list
    }

    // Branch exists, check it out
    execSync(
      `git worktree add "${worktreePath}" ${job.branch_name}`,
      { cwd: barePath, stdio: 'pipe' }
    );
  } else {
    // Branch doesn't exist, create from default branch
    execSync(
      `git worktree add -b ${job.branch_name} "${worktreePath}" ${defaultBranch}`,
      { cwd: barePath, stdio: 'pipe' }
    );
  }

  console.log(`Created worktree at ${worktreePath}`);
  return worktreePath;
}

export async function removeWorktree(repo: CodeRepository, worktreePath: string): Promise<void> {
  const barePath = bareRepoPath(repo);

  try {
    console.log(`Removing worktree at ${worktreePath}...`);
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: barePath,
      stdio: 'pipe'
    });

    // Also remove the directory if it still exists
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }

    console.log(`Removed worktree at ${worktreePath}`);
  } catch (err: any) {
    console.error(`Failed to remove worktree: ${err.message}`);
    // Try force cleanup
    try {
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      execSync('git worktree prune', { cwd: barePath, stdio: 'pipe' });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function commitAndPush(
  worktreePath: string,
  job: AgentJob
): Promise<boolean> {
  const message = job.title || `feat: ${job.branch_name}`;

  // Stage all changes
  execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });

  // Check if there are changes to commit
  try {
    execSync('git diff --cached --quiet', { cwd: worktreePath, stdio: 'pipe' });
    // No changes - just push the branch
    console.log('No changes to commit, pushing branch...');
    return false;
  } catch {
    // Has changes - commit them
    console.log('Committing changes...');
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: worktreePath,
      stdio: 'pipe'
    });
  }

  // Push the branch
  console.log(`Pushing branch ${job.branch_name}...`);
  execSync(`git push -u origin ${job.branch_name}`, {
    cwd: worktreePath,
    stdio: 'pipe'
  });

  return true;
}

export async function createPullRequest(
  repo: CodeRepository,
  job: AgentJob,
  worktreePath: string
): Promise<{ url: string; number: number; title: string; filesChanged: number }> {
  const title = job.title || job.branch_name;
  const body = [
    'Automated by OpsKings Development Intelligence',
    '',
    job.feature_id ? `Feature ID: ${job.feature_id}` : null,
    `Job ID: ${job.id}`
  ].filter(Boolean).join('\n');

  console.log(`Creating pull request for ${job.branch_name}...`);

  // Create PR using GitHub CLI
  const prUrl = execSync(
    `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --head ${job.branch_name} --base ${repo.default_branch || 'main'}`,
    { cwd: worktreePath, encoding: 'utf-8' }
  ).trim();

  // Parse PR number from URL
  const prNumber = parseInt(prUrl.split('/').pop() || '0');

  // Get files changed
  let filesChanged = 0;
  try {
    const filesOutput = execSync(
      `gh pr view ${prNumber} --json files --jq '.files | length'`,
      { cwd: worktreePath, encoding: 'utf-8' }
    );
    filesChanged = parseInt(filesOutput.trim()) || 0;
  } catch {
    // Ignore error getting files changed
  }

  console.log(`Created PR #${prNumber}: ${prUrl}`);

  return {
    url: prUrl,
    number: prNumber,
    title,
    filesChanged
  };
}

export async function removeBareRepo(repo: CodeRepository): Promise<boolean> {
  const barePath = bareRepoPath(repo);

  if (existsSync(barePath)) {
    rmSync(barePath, { recursive: true, force: true });
    return true;
  }

  return false;
}

export function hasChanges(worktreePath: string): boolean {
  try {
    // Check for staged or unstaged changes
    const status = execSync('git status --porcelain', {
      cwd: worktreePath,
      encoding: 'utf-8'
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

// Commit with a custom message and return the commit SHA
export function commitWithMessage(
  worktreePath: string,
  message: string
): { sha: string; hasChanges: boolean } {
  // Stage all changes
  execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });

  // Check if there are changes to commit
  try {
    execSync('git diff --cached --quiet', { cwd: worktreePath, stdio: 'pipe' });
    // No changes to commit
    return { sha: '', hasChanges: false };
  } catch {
    // Has changes - commit them
    console.log(`Committing: ${message}`);
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: worktreePath,
      stdio: 'pipe'
    });

    // Get the commit SHA
    const sha = execSync('git rev-parse HEAD', {
      cwd: worktreePath,
      encoding: 'utf-8'
    }).trim();

    return { sha, hasChanges: true };
  }
}

// Push without creating a PR
export function pushBranch(worktreePath: string, branchName: string): void {
  console.log(`Pushing branch ${branchName}...`);
  execSync(`git push -u origin ${branchName}`, {
    cwd: worktreePath,
    stdio: 'pipe'
  });
}

export async function checkGitAuth(): Promise<{ authenticated: boolean; user: string | null }> {
  try {
    const output = execSync('gh auth status 2>&1', { encoding: 'utf-8' });
    // Match "Logged in to github.com account USERNAME"
    const match = output.match(/Logged in to [^\s]+ account ([^\s(]+)/);
    return {
      authenticated: true,
      user: match ? match[1] : null
    };
  } catch {
    return {
      authenticated: false,
      user: null
    };
  }
}

export async function cloneRepo(repoId: string): Promise<{ repo: string; success: boolean; path?: string; error?: string }> {
  const repo = await getRepositoryById(repoId);
  if (!repo) {
    return { repo: repoId, success: false, error: 'Repository not found' };
  }

  try {
    const barePath = await ensureBareRepo(repo);
    return { repo: `${repo.owner_name}/${repo.repo_name}`, success: true, path: barePath };
  } catch (err: any) {
    return { repo: `${repo.owner_name}/${repo.repo_name}`, success: false, error: err.message };
  }
}

export async function cloneAllRepos(): Promise<{ repo: string; success: boolean; path?: string; error?: string }[]> {
  const repos = await listRepositories();
  const results: { repo: string; success: boolean; path?: string; error?: string }[] = [];

  for (const repo of repos) {
    try {
      const barePath = await ensureBareRepo(repo);
      results.push({ repo: `${repo.owner_name}/${repo.repo_name}`, success: true, path: barePath });
    } catch (err: any) {
      results.push({ repo: `${repo.owner_name}/${repo.repo_name}`, success: false, error: err.message });
    }
  }

  return results;
}
