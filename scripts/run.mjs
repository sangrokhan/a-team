#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const children = [];
let shuttingDown = false;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_TMUX_TMPDIR = path.join(tmpdir(), 'a-team', 'tmux');

function ensureTmuxTmpDir() {
  const envTmuxTmpDir = process.env.TMUX_TMPDIR?.trim();
  const tmuxTmpDir = path.resolve(envTmuxTmpDir && envTmuxTmpDir.length > 0 ? envTmuxTmpDir : WORKER_TMUX_TMPDIR);
  mkdirSync(tmuxTmpDir, { recursive: true });
  return tmuxTmpDir;
}

function resolveWorkerEnvWithTmux(env = process.env) {
  return {
    ...env,
    TMUX_TMPDIR: ensureTmuxTmpDir(),
  };
}

function cleanupNonTeamJobs(stateRoot) {
  const queuePending = path.join(stateRoot, '.queue', 'pending');
  const queueProcessing = path.join(stateRoot, '.queue', 'processing');

  const resolveMode = (jobId) => {
    const recordPath = path.join(stateRoot, jobId, 'record.json');
    if (!existsSync(recordPath)) {
      return null;
    }
    try {
      const raw = readFileSync(recordPath, 'utf8');
      const parsed = JSON.parse(raw);
      return typeof parsed?.mode === 'string' ? parsed.mode : null;
    } catch {
      return null;
    }
  };

  const jobs = existsSync(stateRoot) ? readdirSync(stateRoot, { withFileTypes: true }) : [];
  for (const entry of jobs) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }

    const mode = resolveMode(entry.name);
    if (mode !== 'team') {
      rmSync(path.join(stateRoot, entry.name), { recursive: true, force: true });
    }
  }

  const clearQueueEntryIfNonTeam = (queuePath) => {
    if (!existsSync(queuePath)) {
      return;
    }

    const queueEntries = readdirSync(queuePath, { withFileTypes: true });
    for (const entry of queueEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const jobId = entry.name.slice(0, -'.json'.length);
      const mode = resolveMode(jobId);
      if (mode !== 'team') {
        rmSync(path.join(queuePath, entry.name), { recursive: true, force: true });
      }
    }
  };

  clearQueueEntryIfNonTeam(queuePending);
  clearQueueEntryIfNonTeam(queueProcessing);
}

function parsePort(rawPort) {
  if (!rawPort) {
    return 28080;
  }
  const parsed = Number(rawPort);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 65536 || !Number.isInteger(parsed)) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  return parsed;
}

function ensureTmuxReadyForRun(env = process.env) {
  const envWithTmux = resolveWorkerEnvWithTmux(env);
  const versionResult = spawnSync('tmux', ['-V'], { encoding: 'utf8', env: envWithTmux });
  if (versionResult.error || versionResult.status !== 0) {
    throw new Error('tmux is required. Install tmux (e.g. `brew install tmux`) before running `a-team run`.');
  }

  const sessionName = `a-team-bootstrap-${process.pid}-${Date.now().toString(16)}`;
  const startResult = spawnSync(
    'tmux',
    ['new-session', '-d', '-s', sessionName, '-n', 'bootstrap', 'bash', '-lc', 'cat'],
    { encoding: 'utf8', env: envWithTmux },
  );
  if (startResult.error || startResult.status !== 0) {
    throw new Error(`tmux session start check failed: ${startResult.stderr || startResult.stdout || String(startResult.error)}`);
  }

  const hasSessionResult = spawnSync(
    'tmux',
    ['has-session', '-t', sessionName],
    { encoding: 'utf8', env: envWithTmux },
  );
  if (hasSessionResult.error || hasSessionResult.status !== 0) {
    throw new Error(`tmux session created but not detectable: ${hasSessionResult.stderr || hasSessionResult.stdout || String(hasSessionResult.error)}`);
  }

  const killResult = spawnSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8', env: envWithTmux });
  if (killResult.error || killResult.status !== 0) {
    throw new Error(`tmux session cleanup check failed: ${killResult.stderr || killResult.stdout || String(killResult.error)}`);
  }
}

function parseArgs(argv) {
  const options = {
    port: 28080,
    open: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--no-open') {
      options.open = false;
      continue;
    }
    if (arg === '--open') {
      options.open = true;
      continue;
    }
    if (arg === '--port' && i + 1 < argv.length) {
      options.port = parsePort(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = parsePort(arg.slice('--port='.length));
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return `Usage:
  a-team run [options]

Runs API + Worker locally and opens the monitor UI:
  --port <number>   Port for API server (default: 28080)
  --no-open         Do not open browser automatically
  --help, -h        Show this help
`;
}

function spawnProcess(name, args, env) {
  const child = spawn('npm', args, {
    env,
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  children.push({ name, child });

  child.on('exit', (code) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`[a-team run] ${name} exited with code ${code}`);

    for (const proc of children) {
      if (proc.child.pid !== child.pid && !proc.child.killed) {
        proc.child.kill('SIGTERM');
      }
    }

    process.exitCode = code ?? 0;
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`[a-team run] failed to start ${name}:`, error);
    for (const proc of children) {
      proc.child.kill('SIGTERM');
    }
    process.exitCode = 1;
  });
}

function openUrl(url) {
  const opener = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';

  const openerArgs = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];

  const child = spawn(opener, openerArgs, { stdio: 'ignore', detached: false });
  child.once('error', (error) => {
    console.error('[a-team run] failed to open browser:', error.message);
  });
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[a-team run] ${signal} received, stopping all processes...`);
  for (const proc of children) {
    if (!proc.child.killed) {
      proc.child.kill(signal);
    }
  }
  setTimeout(() => {
    for (const proc of children) {
      if (!proc.child.killed) {
        proc.child.kill('SIGKILL');
      }
    }
  }, 2000);
}

export async function runAteamRun(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
    stdout.write('\n');
    stdout.write(usage());
    return 1;
  }

  if (parsed.help) {
    stdout.write(usage());
    return 0;
  }

  const workerEnv = resolveWorkerEnvWithTmux(env);
  try {
    ensureTmuxReadyForRun(workerEnv);
  } catch (error) {
    stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const sharedEnv = {
    ...workerEnv,
    PORT: String(parsed.port),
    A_TEAM_STATE_ROOT: env.A_TEAM_STATE_ROOT
      ? path.resolve(PROJECT_ROOT, env.A_TEAM_STATE_ROOT)
      : path.resolve(PROJECT_ROOT, '.a-team', 'state', 'jobs'),
  };

  cleanupNonTeamJobs(sharedEnv.A_TEAM_STATE_ROOT);

  spawnProcess('api', ['run', 'dev:api'], sharedEnv);
  spawnProcess('worker', ['run', 'dev:worker'], sharedEnv);

  if (parsed.open) {
    const url = `http://localhost:${parsed.port}/monitor/`;
    setTimeout(() => openUrl(url), 2000);
    console.log(`[a-team run] Monitor UI: ${url}`);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return new Promise(() => {});
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runAteamRun().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
