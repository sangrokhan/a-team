#!/usr/bin/env node
// Mock claude: reads the prompt from `-p <prompt>` and echoes canned output.
// If the prompt contains "PLAN", emits a fenced JSON assignment block.
// If it contains "FAIL", exits non-zero. Otherwise echoes two output lines.
const args = process.argv.slice(2);
const pIdx = args.indexOf("-p");
const prompt = pIdx >= 0 ? args[pIdx + 1] ?? "" : "";

if (prompt.includes("FAIL")) {
  process.stderr.write("mock failure\n");
  process.exit(3);
}
if (prompt.includes("PLAN")) {
  process.stdout.write('```json\n{"assignments":[{"agent":"engineer","subtask":"do work"}]}\n```\n');
  process.exit(0);
}
process.stdout.write("line one\n");
process.stdout.write("line two\n");
process.exit(0);
