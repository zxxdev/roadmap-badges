import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, run, type Runner } from "../src/main.js";

/** A runner that records what the action did, with the given inputs and files. */
function fakeRunner(inputs: Record<string, string>, files: string[] = []) {
  const done = {
    logs: [] as string[],
    outputs: {} as Record<string, string>,
    summary: "",
    failed: undefined as string | undefined,
  };
  const runner: Runner = {
    getInput: (name) => inputs[name] ?? "",
    info: (message) => done.logs.push(message),
    setOutput: (name, value) => {
      done.outputs[name] = value;
    },
    addSummary: (markdown) => {
      done.summary += markdown;
      return Promise.resolve();
    },
    fileExists: (path) => files.includes(path),
    setFailed: (message) => {
      done.failed = message;
    },
  };
  return { runner, done };
}

describe("run", () => {
  it("says it found the catalog and sets catalog-found to true", async () => {
    const { runner, done } = fakeRunner({ catalog: "docs/progress.yml" }, ["docs/progress.yml"]);
    await run(runner);
    expect(done.logs).toEqual([
      "roadmap-badges: Found the catalog at docs/progress.yml. Reading it comes in a later version.",
    ]);
    expect(done.outputs).toEqual({ "catalog-found": "true" });
    expect(done.summary).toContain("Found catalog at `docs/progress.yml`.");
    expect(done.failed).toBeUndefined();
  });

  it("says there is no catalog yet and sets catalog-found to false", async () => {
    const { runner, done } = fakeRunner({ catalog: "progress.yml" });
    await run(runner);
    expect(done.logs).toEqual(["roadmap-badges: No catalog at progress.yml yet."]);
    expect(done.outputs).toEqual({ "catalog-found": "false" });
    expect(done.failed).toBeUndefined();
  });

  it("uses progress.yml when the input is empty or blank", async () => {
    const { runner, done } = fakeRunner({ catalog: "  " }, [DEFAULT_CATALOG]);
    await run(runner);
    expect(done.outputs).toEqual({ "catalog-found": "true" });
    expect(done.logs[0]).toContain(`at ${DEFAULT_CATALOG}.`);
  });

  it("keeps a backtick in the path from breaking the summary's code span", async () => {
    const { runner, done } = fakeRunner({ catalog: "a`b.yml" });
    await run(runner);
    expect(done.summary).toContain("`a'b.yml`");
  });

  it("fails the step with the error's message instead of throwing", async () => {
    const { runner, done } = fakeRunner({});
    runner.fileExists = () => {
      throw new Error("disk unavailable");
    };
    await expect(run(runner)).resolves.toBeUndefined();
    expect(done.failed).toBe("disk unavailable");
  });
});
