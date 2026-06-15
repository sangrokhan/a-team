import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ateam-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}
