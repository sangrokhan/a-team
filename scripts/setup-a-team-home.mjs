#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function usage() {
  return `Usage:
  a-team setup

Creates ~/.a-team directory and initializes:
  - prompts/ (copied from repository prompts/)
  - skills/  (copied from repository skills/)
  - ~/.codex/prompts -> ~/.a-team/prompts
  - ~/.claude/agents -> ~/.a-team/prompts
  - ~/.codex/skills -> ~/.a-team/skills
  - ~/.claude/skills -> ~/.a-team/skills
  - jobs/, memory/, workspace/ (created if missing)
`;
}

function ts() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}` +
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`
  );
}

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readSymlinkTarget(linkPath) {
  const raw = await fs.readlink(linkPath);
  return path.resolve(path.dirname(linkPath), raw);
}

async function createDirSymlink(targetPath, sourceDir, dryRun) {
  if (dryRun) {
    return;
  }
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(sourceDir, targetPath, type);
}

async function moveToBackup(targetPath, dryRun, backups) {
  const backupPath = `${targetPath}.backup-${ts()}`;
  if (!dryRun) {
    await fs.rename(targetPath, backupPath);
  }
  backups.push({ from: targetPath, to: backupPath });
}

async function bindPath(targetPath, sourceDir, state) {
  const { dryRun, bindings } = state;
  const sourceResolved = path.resolve(sourceDir);

  if (!(await exists(targetPath))) {
    await createDirSymlink(targetPath, sourceResolved, dryRun);
    bindings.push({
      target: targetPath,
      source: sourceResolved,
      action: 'created',
    });
    return;
  }

  const stat = await fs.lstat(targetPath);
  if (stat.isSymbolicLink()) {
    const current = await readSymlinkTarget(targetPath);
    if (current === sourceResolved) {
      bindings.push({
        target: targetPath,
        source: sourceResolved,
        action: 'already_bound',
      });
      return;
    }
    await moveToBackup(targetPath, dryRun, state.backups);
    await createDirSymlink(targetPath, sourceResolved, dryRun);
    bindings.push({
      target: targetPath,
      source: sourceResolved,
      action: 'relinked',
    });
    return;
  }

  await moveToBackup(targetPath, dryRun, state.backups);
  await createDirSymlink(targetPath, sourceResolved, dryRun);
  bindings.push({
    target: targetPath,
    source: sourceResolved,
    action: 'replaced',
  });
}

async function copyDirectory(sourceDir, targetDir, options = {}) {
  const { dryRun } = options;
  const targetExists = await exists(targetDir);
  if (dryRun) {
    return targetExists ? 'ready' : 'created';
  }

  await ensureDir(path.dirname(targetDir));
  await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
  return targetExists ? 'updated' : 'created';
}

export async function runSetupAteamHome(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  const args = new Set(argv);

  if (args.has('--help') || args.has('-h')) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const homeRoot = path.join(os.homedir(), '.a-team');
  const actions = [];
  const result = {
    home: homeRoot,
    copied: [],
    created: [],
    skipped: [],
    errors: [],
    bindings: [],
    backups: [],
  };

  try {
    await ensureDir(homeRoot);
    result.created.push(homeRoot);

    const sourceItems = ['prompts', 'skills'];
    for (const name of sourceItems) {
      const sourceDir = path.join(repoRoot, name);
      const targetDir = path.join(homeRoot, name);
      if (!(await exists(sourceDir))) {
        result.errors.push(`Missing source directory: ${sourceDir}`);
        continue;
      }
      try {
        const status = await copyDirectory(sourceDir, targetDir);
        if (status === 'created') {
          actions.push(`copied:${name}`);
          result.copied.push(targetDir);
        } else {
          actions.push(`updated:${name}`);
          result.copied.push(targetDir);
        }
      } catch (error) {
        result.errors.push(`Failed to copy ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const workspaceDirs = ['jobs', 'memory', 'workspace'];
    for (const name of workspaceDirs) {
      const targetDir = path.join(homeRoot, name);
      const existsBefore = await exists(targetDir);
      await ensureDir(targetDir);
      if (!existsBefore) {
        result.created.push(targetDir);
      } else {
        result.skipped.push(targetDir);
      }
    }

    const codexRoot = path.join(os.homedir(), '.codex');
    const claudeRoot = path.join(os.homedir(), '.claude');
    await ensureDir(codexRoot);
    await ensureDir(claudeRoot);

    await bindPath(path.join(codexRoot, 'prompts'), path.join(homeRoot, 'prompts'), result);
    await bindPath(path.join(claudeRoot, 'agents'), path.join(homeRoot, 'prompts'), result);
    await bindPath(path.join(codexRoot, 'skills'), path.join(homeRoot, 'skills'), result);
    await bindPath(path.join(claudeRoot, 'skills'), path.join(homeRoot, 'skills'), result);

    stdout.write(`${JSON.stringify({ ...result, actions }, null, 2)}\n`);
    if (result.errors.length > 0) {
      stderr.write(`a-team setup completed with ${result.errors.length} error(s).\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    stderr.write(`a-team setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function main() {
  const exitCode = await runSetupAteamHome();
  process.exitCode = exitCode;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
