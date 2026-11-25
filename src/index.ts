/**
 * Entry point that GitHub runs (bundled into dist/index.js): connects run() to
 * the real runner through the GitHub Actions toolkit.
 */
import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { run } from "./main.js";

await run({
  getInput: (name) => core.getInput(name),
  info: (message) => {
    core.info(message);
  },
  error: (message, location) => {
    core.error(
      message,
      location && {
        file: location.file,
        startLine: location.line,
        startColumn: location.column,
      },
    );
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
  setFailed: (message) => {
    core.setFailed(message);
  },
});
