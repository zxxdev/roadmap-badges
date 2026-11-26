// The example reports in tests/fixtures/junit were written by the real tools
// (generate.sh), so these tests check the reader against what Vitest, Pester
// and pytest actually emit, and the whole rule against a result worked out by
// hand in catalog.yml.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "../src/catalog/parse.js";
import { evaluate } from "../src/evidence/evaluate.js";
import { parseJUnitReport } from "../src/evidence/junit.js";

const FOLDER = new URL("fixtures/junit/", import.meta.url);
const REPORTS = ["vitest.xml", "pester.xml", "pytest.xml"];

function read(file: string): string {
  return readFileSync(new URL(file, FOLDER), "utf8");
}

/** "status name" for every case in a report, in order. */
function cases(file: string): string[] {
  return parseJUnitReport(read(file), file).map(({ status, name }) => `${status} ${name}`);
}

describe("example reports from real tools @evidence.junit", () => {
  it("reads Vitest's report, which joins describe and test names with >", () => {
    expect(cases("vitest.xml")).toEqual([
      "passed users > gets one user @vitest.get",
      "passed users > gets every user @vitest.get-all",
      "passed users > lists users @vitest.list",
      "failed users > lists users in pages @vitest.list",
      "skipped users > exports users @vitest.export",
      "passed users > has a typo in its tag @vitest.gte",
    ]);
  });

  it("reads Pester's report, which starts with a byte order mark", () => {
    expect(read("pester.xml").charCodeAt(0)).toBe(0xfeff);
    expect(cases("pester.xml")).toEqual([
      "passed Audit.reads the audit log @pester.audit",
      "failed Audit.writes the report @pester.report",
      "skipped Audit.audits a remote computer @pester.remote",
      "passed Inventory.lists the installed software",
    ]);
  });

  it("reads pytest's report, which writes an <error> when a fixture fails", () => {
    expect(cases("pytest.xml")).toEqual([
      "passed test_parse",
      "failed test_render",
      "skipped test_network",
      "passed test_param[@pytest.param]",
      "error test_setup",
    ]);
  });

  it("gives the result worked out by hand in catalog.yml", () => {
    const parsed = parseCatalog(read("catalog.yml"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const result = evaluate(
      parsed.catalog,
      REPORTS.flatMap((file) => parseJUnitReport(read(file), file)),
    );

    const statuses = Object.fromEntries(
      result.areas.flatMap((area) => area.items).map((item) => [item.id, item.status]),
    );
    expect(statuses).toEqual({
      "vitest.get": "done",
      "vitest.get-all": "done",
      "vitest.list": "failed",
      "vitest.export": "skipped",
      "vitest.import": "no-tests",
      "pester.audit": "done",
      "pester.report": "failed",
      "pester.remote": "skipped",
      "pester.inventory": "done",
      "pytest.parse": "done",
      "pytest.render": "failed",
      "pytest.network": "skipped",
      "pytest.param": "done",
      "pytest.setup": "failed",
      "pytest.removed": "missing-tests",
      "pytest.legacy": "dropped",
    });
    expect(result.areas.map(({ id, done, total, percent }) => [id, done, total, percent])).toEqual([
      ["vitest", 2, 5, 40],
      ["pester", 2, 4, 50],
      ["pytest", 2, 6, 33],
    ]);
    expect(result).toMatchObject({ done: 6, total: 15, percent: 40 });
    expect(result.orphans.map(({ tag }) => tag)).toEqual(["vitest.gte"]);
  });
});
