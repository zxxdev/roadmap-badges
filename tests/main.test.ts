import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, run, tableCell, type FileLocation, type Runner } from "../src/main.js";

/**
 * A runner that records what the action did, with the given inputs and files.
 * findFiles answers from `globs` (pattern to files), or finds a file whose
 * path is exactly the pattern.
 */
function fakeRunner(
  inputs: Record<string, string>,
  files: Record<string, string> = {},
  globs: Record<string, string[]> = {},
) {
  const done = {
    logs: [] as string[],
    warnings: [] as string[],
    errors: [] as { message: string; location: FileLocation | undefined }[],
    outputs: {} as Record<string, string>,
    summary: "",
    failed: undefined as string | undefined,
  };
  const runner: Runner = {
    getInput: (name) => inputs[name] ?? "",
    info: (message) => done.logs.push(message),
    warning: (message) => done.warnings.push(message),
    error: (message, location) => done.errors.push({ message, location }),
    setOutput: (name, value) => {
      done.outputs[name] = value;
    },
    addSummary: (markdown) => {
      done.summary += markdown;
      return Promise.resolve();
    },
    readFile: (path) => files[path],
    findFiles: (pattern) => globs[pattern] ?? (pattern in files ? [pattern] : []),
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

/** A JUnit report with the given <testcase> elements. */
function report(...cases: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="tests/api.test.ts">
    ${cases.join("\n    ")}
  </testsuite>
</testsuites>
`;
}

const PASSING = report(
  `<testcase classname="tests/api.test.ts" name="api > gets a user @api.get"/>`,
);

describe("run @catalog.read", () => {
  it("reads the catalog and the reports, and reports the progress of each area", async () => {
    const { runner, done } = fakeRunner(
      { catalog: "docs/progress.yml", reports: "reports/junit.xml" },
      { "docs/progress.yml": CATALOG, "reports/junit.xml": PASSING },
    );
    await run(runner);

    expect(done.failed).toBeUndefined();
    expect(done.errors).toEqual([]);
    expect(done.warnings).toEqual([]);
    expect(done.logs).toEqual([
      "roadmap-badges: read docs/progress.yml for demo: 2 areas, 2 items and 1 dropped.",
      "roadmap-badges: read 1 test from 1 report.",
      "roadmap-badges: 2 of 2 items done (100%).",
    ]);
    expect(done.outputs).toEqual({
      areas: "2",
      items: "2",
      dropped: "1",
      done: "2",
      percent: "100",
    });
    expect(done.summary).toContain(
      "**demo**: 2 of 2 items done (100%). Catalog `docs/progress.yml`, 1 JUnit report with 1 test.",
    );
    expect(done.summary).toContain("| API \\| v2 | 1 | 1 | 100% | 1 |");
    expect(done.summary).toContain("| Docs | 1 | 1 | 100% | 0 |");
    expect(done.summary).not.toContain("not done");
  });

  it("uses progress.yml when the input is empty or blank", async () => {
    const { runner, done } = fakeRunner(
      { catalog: "  ", reports: "junit.xml" },
      { [DEFAULT_CATALOG]: CATALOG, "junit.xml": PASSING },
    );
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

describe("run with test reports @evidence.junit", () => {
  it("lists every item that is not done, with the reason", async () => {
    const catalog = `project: demo
areas:
  - id: api
    title: API
    items:
      - { id: api.get, title: Get a user, evidence: junit }
      - { id: api.list, title: List users, evidence: junit }
      - { id: api.find, title: Find users, evidence: junit, tests: [{ name: test_find }] }
      - { id: api.export, title: Export, evidence: junit }
      - { id: api.docs, title: Docs, evidence: manual, done: false }
`;
    const junit = report(
      `<testcase classname="api" name="gets a user @api.get"><failure message="500"/></testcase>`,
      `<testcase classname="api" name="lists users @api.list"><skipped/></testcase>`,
    );
    const { runner, done } = fakeRunner(
      { reports: "junit.xml" },
      { "progress.yml": catalog, "junit.xml": junit },
    );
    await run(runner);

    expect(done.failed).toBeUndefined();
    expect(done.outputs).toMatchObject({ done: "0", percent: "0" });
    expect(done.summary).toContain("<summary>5 items not done</summary>");
    expect(done.summary).toContain(
      '| `api.get` Get a user | API | failed: "gets a user @api.get" |',
    );
    expect(done.summary).toContain(
      '| `api.list` List users | API | skipped: "lists users @api.list" |',
    );
    expect(done.summary).toContain(
      '| `api.find` Find users | API | not in any report: "test\\_find" |',
    );
    expect(done.summary).toContain("| `api.export` Export | API | no test is tagged @api.export |");
    expect(done.summary).toContain("| `api.docs` Docs | API | marked as not done |");
  });

  it("fails when the catalog has items proved by tests but no reports were given", async () => {
    const { runner, done } = fakeRunner({}, { "progress.yml": CATALOG });
    await run(runner);

    expect(done.failed).toBe(
      "roadmap-badges: the catalog has items proved by tests, but no reports were given. " +
        'Set the "reports" input to the JUnit XML files that your tests write.',
    );
    expect(done.outputs).not.toHaveProperty("done");
  });

  it("needs no reports when every item that counts is manual", async () => {
    const catalog = CATALOG.replace(
      "        evidence: junit\n      - id: api.old",
      "        evidence: manual\n        done: false\n      - id: api.old",
    );
    const { runner, done } = fakeRunner({}, { "progress.yml": catalog });
    await run(runner);

    expect(done.failed).toBeUndefined();
    expect(done.logs.at(-1)).toBe("roadmap-badges: 1 of 2 items done (50%).");
    expect(done.summary).toContain("Catalog `progress.yml`, no test reports.");
  });

  it("fails when a pattern matches no file, instead of reporting 0 %", async () => {
    const { runner, done } = fakeRunner(
      { reports: "reports/*.xml\ntest-results/*.xml" },
      { "progress.yml": CATALOG, "test-results/a.xml": PASSING },
      { "test-results/*.xml": ["test-results/a.xml"] },
    );
    await run(runner);

    expect(done.errors).toEqual([
      {
        message: "roadmap-badges: no file matches the reports pattern reports/*.xml",
        location: undefined,
      },
    ]);
    expect(done.failed).toBe("roadmap-badges: 1 problem with the test reports.");
    expect(done.summary).toContain("- `no file matches the reports pattern reports/*.xml`");
    expect(done.outputs).not.toHaveProperty("percent");
  });

  it("fails on reports it cannot read, naming each file and the line when it is known", async () => {
    const { runner, done } = fakeRunner(
      { reports: "reports/*.xml" },
      {
        "progress.yml": CATALOG,
        "reports/broken.xml": "<testsuite>\n<testcase name='a'></testsuite>",
        "reports/empty.xml": "",
      },
      { "reports/*.xml": ["reports/broken.xml", "reports/empty.xml"] },
    );
    await run(runner);

    expect(done.errors).toEqual([
      {
        message: expect.stringMatching(
          /^roadmap-badges: reports\/broken\.xml:2:\d+: invalid XML: /,
        ) as string,
        location: { file: "reports/broken.xml", line: 2, column: expect.any(Number) as number },
      },
      { message: "roadmap-badges: reports/empty.xml: the file is empty", location: undefined },
    ]);
    expect(done.failed).toBe("roadmap-badges: 2 problems with the test reports.");
  });

  it("reads a file that two patterns match only once", async () => {
    const { runner, done } = fakeRunner(
      { reports: "reports/*.xml\nreports/junit.xml" },
      { "progress.yml": CATALOG, "reports/junit.xml": PASSING },
      { "reports/*.xml": ["reports/junit.xml"] },
    );
    await run(runner);

    expect(done.logs).toContain("roadmap-badges: read 1 test from 1 report.");
    expect(done.summary).not.toContain("more than once");
  });

  it("warns about a report with no test cases and carries on", async () => {
    const { runner, done } = fakeRunner(
      { reports: "a.xml\nnone.xml" },
      { "progress.yml": CATALOG, "a.xml": PASSING, "none.xml": "<testsuites/>" },
    );
    await run(runner);

    expect(done.warnings).toEqual(["roadmap-badges: none.xml has no test cases."]);
    expect(done.failed).toBeUndefined();
    expect(done.outputs).toMatchObject({ percent: "100" });
  });

  it("notes tests that appear more than once and tests that passed on a retry", async () => {
    const twice = report(
      `<testcase classname="api" name="gets a user @api.get"/>`,
      `<testcase classname="api" name="gets a user @api.get"><flakyFailure/></testcase>`,
    );
    const { runner, done } = fakeRunner(
      { reports: "junit.xml" },
      { "progress.yml": CATALOG, "junit.xml": twice },
    );
    await run(runner);

    expect(done.summary).toContain(
      "- 1 test appears more than once; a failure in any run counts, and a pass counts over a skip.",
    );
    expect(done.summary).toContain("- 1 test passed only after a retry.");
  });
});

describe("run with tags that match no item @evidence.link", () => {
  const typo = report(
    `<testcase classname="api" name="gets a user @api.get"/>`,
    `<testcase classname="api" name="gets a user @api.gte"/>`,
  );
  const message =
    'roadmap-badges: the tag @api.gte in "gets a user @api.gte" (junit.xml) matches no item in the catalog. Is the id misspelt?';

  it("warns about each tag that matches no item", async () => {
    const { runner, done } = fakeRunner(
      { reports: "junit.xml" },
      { "progress.yml": CATALOG, "junit.xml": typo },
    );
    await run(runner);

    expect(done.warnings).toEqual([message]);
    expect(done.failed).toBeUndefined();
    expect(done.summary).toContain("- Tags that match no item: `@api.gte`.");
  });

  it("fails the step on such a tag when strict is on, after setting the outputs", async () => {
    const { runner, done } = fakeRunner(
      { reports: "junit.xml", strict: "true" },
      { "progress.yml": CATALOG, "junit.xml": typo },
    );
    await run(runner);

    expect(done.errors).toEqual([{ message, location: undefined }]);
    expect(done.failed).toBe(
      'roadmap-badges: 1 tag in test names matches no item, and "strict" is on.',
    );
    expect(done.outputs).toMatchObject({ done: "2", percent: "100" });
  });

  it("rejects a strict input that is not true or false", async () => {
    const { runner, done } = fakeRunner({ strict: "yes" }, { "progress.yml": CATALOG });
    await run(runner);
    expect(done.failed).toBe(
      'roadmap-badges: the "strict" input must be true or false, not "yes".',
    );
  });
});

describe("tableCell", () => {
  it("keeps catalog text from ending the cell, adding HTML or formatting", () => {
    expect(tableCell("a | <b>\n*c* & [d](e) `f` _g_ \\ $x$ ~~h~~")).toBe(
      "a \\| &lt;b&gt; \\*c\\* &amp; \\[d\\](e) \\`f\\` \\_g\\_ \\\\ \\$x\\$ \\~\\~h\\~\\~",
    );
  });
});
