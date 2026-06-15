import { spawn } from "node:child_process";

export interface RunOptions {
  bin: string;          // claude binary or mock path
  prompt: string;
  model?: string;
  cwd: string;
  extraArgs?: string[]; // e.g. ["--dangerously-skip-permissions"]
}

export interface RunResult { text: string; stderr: string; code: number; }

export function runAgent(opts: RunOptions, onChunk: (chunk: string) => void): Promise<RunResult> {
  const args = ["-p", opts.prompt];
  if (opts.model) args.push("--model", opts.model);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  return new Promise((resolve) => {
    const child = spawn(opts.bin, args, { cwd: opts.cwd });
    let text = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => { text += d; onChunk(d); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => { stderr += d; });
    child.on("close", (code) => resolve({ text, stderr, code: code ?? 0 }));
    child.on("error", (err) => resolve({ text, stderr: stderr + String(err), code: 1 }));
  });
}
