// Reading infrastructure-as-code from disk, for the CLI and for the Action when
// it runs outside a pull request. Node only. Skips node_modules, .git, and
// .terraform, never follows symbolic links while walking, and reads each file
// once. File contents stay on the machine.

import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { looksLikeIacSource } from "@/lib/reviewer/diagram-parse";

import type { IacFile } from "./review";

export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", ".git", ".terraform"]);

/** Extensions worth reading when walking a directory. A file given by name is always read. */
const CANDIDATE_EXTENSIONS: ReadonlySet<string> = new Set([".tf", ".tfvars", ".template", ".yaml", ".yml", ".json"]);

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_FILES = 2000;
/** All files together; keeps a review of a huge repository from filling memory. */
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export type CollectLimits = { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number };

export type CollectResult = {
  files: IacFile[];
  /** read but not infrastructure-as-code, or too large */
  skipped: string[];
  /** paths that could not be read */
  errors: string[];
};

function display(file: string, cwd: string): string {
  const relative = path.relative(cwd, file);
  const shown = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
  return shown.split(path.sep).join("/");
}

function* walk(directory: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* walk(full);
    } else if (entry.isFile() && CANDIDATE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

/** Read the IaC files under the given files and directories. */
export function collectIacFiles(
  inputs: readonly string[],
  cwd: string = process.cwd(),
  limits: CollectLimits = {},
): CollectResult {
  const maxFiles = limits.maxFiles ?? MAX_FILES;
  const maxFileBytes = limits.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const result: CollectResult = { files: [], skipped: [], errors: [] };
  const seen = new Set<string>();
  let totalBytes = 0;

  // A file named on the command line that is not IaC is reported; one found
  // while walking a directory is simply not part of the review.
  const consider = (file: string, named: boolean) => {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const shown = display(resolved, cwd);
    if (result.files.length >= maxFiles) {
      result.skipped.push(`${shown} (more than ${maxFiles} files)`);
      return;
    }
    let size = 0;
    try {
      size = statSync(resolved).size;
    } catch {
      result.errors.push(shown);
      return;
    }
    if (size > maxFileBytes) {
      result.skipped.push(`${shown} (larger than ${Math.round(maxFileBytes / 1024)} KB)`);
      return;
    }
    if (totalBytes + size > maxTotalBytes) {
      result.skipped.push(`${shown} (past the total size limit)`);
      return;
    }
    let content: string;
    try {
      content = readFileSync(resolved, "utf8");
    } catch {
      result.errors.push(shown);
      return;
    }
    if (looksLikeIacSource(shown, content)) {
      totalBytes += size;
      result.files.push({ path: shown, content });
    } else if (named) result.skipped.push(shown);
  };

  for (const input of inputs) {
    const resolved = path.resolve(cwd, input);
    let stats;
    try {
      stats = lstatSync(resolved);
      if (stats.isSymbolicLink()) stats = statSync(resolved);
    } catch {
      result.errors.push(input);
      continue;
    }
    if (stats.isDirectory()) for (const file of walk(resolved)) consider(file, false);
    else if (stats.isFile()) consider(resolved, true);
    else result.errors.push(input);
  }
  return result;
}
