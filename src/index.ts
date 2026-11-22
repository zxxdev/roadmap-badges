/**
 * Entry point that GitHub runs (bundled into dist/index.js): connects run() to
 * the real runner through the GitHub Actions toolkit.
 */
import { existsSync } from "node:fs";
import * as core from "@actions/core";
import { run } from "./main.js";

await run({
  getInput: (name) => core.getInput(name),
  info: (message) => {
    core.info(message);
  },
  setOutput: (name, value) => {
    core.setOutput(name, value);
  },
  addSummary: async (markdown) => {
    await core.summary.addRaw(markdown).write();
  },
  fileExists: (path) => existsSync(path),
  setFailed: (message) => {
    core.setFailed(message);
  },
});
