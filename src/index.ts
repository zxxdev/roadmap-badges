/**
 * Entry point that GitHub runs (bundled into dist/index.js): connects run() to
 * the real runner through the GitHub Actions toolkit.
 */
import { globSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import * as core from "@actions/core";
import { run, type FileLocation } from "./main.js";

/** Folders that a pattern such as "reports/**" never searches. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);

/** A location as the toolkit's annotation properties. */
function annotation(location: FileLocation | undefined) {
  return (
    location && {
      file: location.file,
      startLine: location.line,
      startColumn: location.column,
    }
  );
}

await run({
  getInput: (name) => core.getInput(name),
  info: (message) => {
    core.info(message);
  },
  warning: (message, location) => {
    core.warning(message, annotation(location));
  },
  error: (message, location) => {
    core.error(message, annotation(location));
  },
  setOutput: (name, value) => {
    core.setOutput(name, value);
  },
  addSummary: async (markdown) => {
    await core.summary.addRaw(markdown).write();
  },
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  },
  // Relative to the working directory, which is the repository's root in a
  // workflow. Sorted, so the reports are always read in the same order.
  findFiles: (pattern) =>
    globSync(pattern, { exclude: (path) => SKIPPED_FOLDERS.has(basename(path)) }).sort(),
  setFailed: (message) => {
    core.setFailed(message);
  },
});
