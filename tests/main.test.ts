import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, run, tableCell, type FileLocation, type Runner } from "../src/main.js";

/** A runner that records what the action did, with the given inputs and files. */
function fakeRunner(inputs: Record<string, string>, files: Record<string, string> = {}) {
  const done = {
    logs: [] as string[],
    errors: [] as { message: string; location: FileLocation | undefined }[],
    outputs: {} as Record<string, string>,
    summary: "",
    failed: undefined as string | undefined,
  };
  const runner: Runner = {
    getInput: (name) => inputs[name] ?? "",
    info: (message) => done.logs.push(message),
    error: (message, location) => done.errors.push({ message, location }),
    setOutput: (name, value) => {
      done.outputs[name] = value;
    },
    addSummary: (markdown) => {
      done.summary += markdown;
      return Promise.resolve();
    },
    readFile: (path) => files[path],
    setFailed: (message) => {
      done.failed = message;
    },
  };
  return { runner, done };
}

const CATALOG = `project: demo
areas:
  - id: api
    title: API | v2
    items:
      - id: api.get
        title: Get
        evidence: junit
      - id: api.old
        title: Old endpoint
        evidence: junit
        dropped: Replaced by api.get
  - id: docs
    title: Docs
    items:
      - id: docs.guide
        title: Guide
        evidence: manual
        done: true
`;

describe("run @catalog.read", () => {
  it("reads the catalog and reports areas, items and dropped items", async () => {
    const { runner, done } = fakeRunner(
      { catalog: "docs/progress.yml" },
      { "docs/progress.yml": CATALOG },
    );
    await run(runner);
    expect(done.failed).toBeUndefined();
    expect(done.errors).toEqual([]);
    expect(done.logs).toEqual([
      "roadmap-badges: read docs/progress.yml for demo: 2 areas, 2 items and 1 dropped.",
    ]);
    expect(done.outputs).toEqual({ areas: "2", items: "2", dropped: "1" });
    expect(done.summary).toContain("Catalog `docs/progress.yml` for **demo**.");
    expect(done.summary).toContain("| API \\| v2 | 1 | 1 |");
    expect(done.summary).toContain("| Docs | 1 | 0 |");
  });

  it("uses progress.yml when the input is empty or blank", async () => {
    const { runner, done } = fakeRunner({ catalog: "  " }, { [DEFAULT_CATALOG]: CATALOG });
    await run(runner);
    expect(done.failed).toBeUndefined();
    expect(done.logs[0]).toContain(`read ${DEFAULT_CATALOG} for demo`);
  });

  it("fails when there is no catalog, saying how to fix it", async () => {
    const { runner, done } = fakeRunner({ catalog: "progress.yml" });
    await run(runner);
    expect(done.failed).toBe(
      'roadmap-badges: no catalog at progress.yml. Create it, or set the "catalog" input to its path.',
    );
    expect(done.outputs).toEqual({});
    expect(done.summary).toContain("No catalog at `progress.yml`.");
  });

  it("fails on an invalid catalog with one annotation per problem", async () => {
    const broken = CATALOG.replace("title: Get", 'title: ""').replace("done: true", "done: 1");
    const { runner, done } = fakeRunner({ catalog: "progress.yml" }, { "progress.yml": broken });
    await run(runner);
    expect(done.errors).toEqual([
      {
        message: "progress.yml:7:16 areas[0].items[0].title: must not be empty",
        location: { file: "progress.yml", line: 7, column: 16 },
      },
      {
        message: "progress.yml:19:15 areas[1].items[0].done: must be true or false, not 1",
        location: { file: "progress.yml", line: 19, column: 15 },
      },
    ]);
    expect(done.failed).toBe("roadmap-badges: the catalog at progress.yml has 2 problems.");
    expect(done.outputs).toEqual({});
    expect(done.summary).toContain(
      "- `progress.yml:7:16 areas[0].items[0].title: must not be empty`",
    );
  });

  it("keeps a backtick in the path from breaking the summary's code span", async () => {
    const { runner, done } = fakeRunner({ catalog: "a`b.yml" });
    await run(runner);
    expect(done.summary).toContain("`a'b.yml`");
  });

  it("fails the step with the error's message instead of throwing", async () => {
    const { runner, done } = fakeRunner({});
    runner.readFile = () => {
      throw new Error("disk unavailable");
    };
    await expect(run(runner)).resolves.toBeUndefined();
    expect(done.failed).toBe("disk unavailable");
    expect(done.outputs).toEqual({});
    expect(done.summary).toBe("");
  });
});

describe("tableCell", () => {
  it("keeps catalog text from ending the cell, adding HTML or formatting", () => {
    expect(tableCell("a | <b>\n*c* & [d](e) `f` _g_ \\")).toBe(
      "a \\| &lt;b&gt; \\*c\\* &amp; \\[d\\](e) \\`f\\` \\_g\\_ \\\\",
    );
  });
});
