import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSetupAteamHome } from '../setup-a-team-home.mjs';
import { runAteamRun } from '../run.mjs';

const EXECUTABLE_TO_COMMAND = new Map([
  ['a-team-run', 'run'],
  ['a-team-run.mjs', 'run'],
  ['a-team-setup', 'setup'],
  ['a-team-setup.mjs', 'setup'],
  ['run', 'run'],
  ['setup', 'setup'],
]);

function helpText() {
  return `Usage:
  a-team <command> [options]

Commands:
  run                Run API+Worker and open monitor UI for active teams.
  setup              Initialize ~/.a-team and link ~/.codex/prompts, ~/.claude/{agents,skills}, ~/.codex/skills to it.
  help               Show this help.

Examples:
  a-team run
  a-team setup
`;
}

function resolveCommand(invokedPath, argv) {
  const invokedName = path.basename(invokedPath ?? '');
  const mapped = EXECUTABLE_TO_COMMAND.get(invokedName);
  if (mapped) {
    return { command: mapped, args: argv };
  }

  if (argv.length === 0) {
    return { command: 'help', args: [] };
  }

  return { command: argv[0], args: argv.slice(1) };
}

export async function runBinCommand(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  const invokedPath = options.invokedPath ?? process.argv[1];
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const { command, args } = resolveCommand(invokedPath, argv);

  if (command === 'help' || command === '--help' || command === '-h') {
    stdout.write(helpText());
    return 0;
  }

  if (command === 'setup') {
    return runSetupAteamHome({ argv: args, env, stdout, stderr });
  }

  if (command === 'run') {
    return runAteamRun({ argv: args, env, stdout, stderr });
  }

  stderr.write(`Unknown command: ${command}\n`);
  stderr.write(helpText());
  return 1;
}

async function main() {
  const exitCode = await runBinCommand();
  process.exitCode = exitCode;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
