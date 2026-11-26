/**
 * Decides which catalog items are done and computes the progress of each
 * area. It is a pure function of the catalog and the test cases: no files, no
 * clock. That is where the rule lives, so that is where most tests go.
 *
 * The rule (docs/adr/0003): an item proved by tests is done when at least one
 * test is linked to it and all its linked tests pass. A missing, skipped or
 * failed test means not done, never "unknown": otherwise deleting or skipping
 * a test would raise the percentage.
 */
import type { Catalog, CatalogItem } from "../catalog/schema.js";
import type { TestCase, TestStatus } from "./junit.js";

/** One test after merging every time it appears in the reports. */
export interface Test {
  classname: string;
  name: string;
  status: TestStatus;
  /** The reports it appears in, without repeats, in reading order. */
  files: string[];
  /** How many times it appears. More than one means a duplicate. */
  runs: number;
  /** It passed only after a retry in at least one run. */
  flaky: boolean;
}

/**
 * - done: all its tests pass (junit), or its done flag is true (manual).
 * - failed: a linked test failed or ended in an error.
 * - missing-tests: a test listed in its "tests" selectors is in no report.
 * - skipped: a linked test was skipped.
 * - no-tests: no test is linked to it.
 * - not-done: a manual item whose done flag is false.
 * - dropped: left out of the total, with the reason in the catalog.
 */
export type ItemStatus =
  "done" | "failed" | "missing-tests" | "skipped" | "no-tests" | "not-done" | "dropped";

export interface TestSelector {
  name: string;
  classname?: string | undefined;
}

export interface ItemResult {
  id: string;
  title: string;
  evidence: CatalogItem["evidence"];
  status: ItemStatus;
  /** Why it was dropped, for dropped items. */
  dropped?: string | undefined;
  /** The tests linked to it, by tag or by selector. */
  tests: Test[];
  /** Selectors that matched no test. */
  missing: TestSelector[];
}

export interface Progress {
  done: number;
  /** Items that count: dropped items do not. */
  total: number;
  /** Rounded down, so 100 means everything is done. Null when there is nothing to count. */
  percent: number | null;
}

export interface AreaResult extends Progress {
  id: string;
  title: string;
  dropped: number;
  items: ItemResult[];
}

/** A tag in a test name that matches no item: usually a typo in the id. */
export interface OrphanTag {
  tag: string;
  tests: Test[];
}

export interface Evaluation extends Progress {
  areas: AreaResult[];
  orphans: OrphanTag[];
  /** Every distinct test read from the reports. */
  tests: Test[];
}

/**
 * When the same test appears more than once (two reports, or a retry), a
 * failure anywhere wins. Otherwise a pass wins over a skip: a test that runs
 * and passes on one system and is skipped on another (a Windows-only test in
 * a Linux and Windows build) has been proved.
 */
const MERGE_RANK: Record<TestStatus, number> = { skipped: 0, passed: 1, failed: 2, error: 3 };

/**
 * A tag is "@" and an item id, as a whole word: "@api.get" in "@api.get-all"
 * is not a tag for api.get. The "@" cannot follow a letter or digit, so an
 * email address in a name is not a tag.
 */
const TAG = /(?<![A-Za-z0-9_])@([a-z0-9]+(?:[.-][a-z0-9]+)*)(?![A-Za-z0-9_]|[.-][A-Za-z0-9])/g;

/** The item ids tagged in a test name, without repeats. */
export function findTags(name: string): string[] {
  return [...new Set(Array.from(name.matchAll(TAG), (match) => match[1] ?? ""))];
}

/** Merges the cases that are the same test (same classname and name). */
export function mergeTests(cases: readonly TestCase[]): Test[] {
  const tests = new Map<string, Test>();
  for (const { classname, name, status, file, flaky } of cases) {
    const key = `${classname}\u0000${name}`;
    const seen = tests.get(key);
    if (seen === undefined) {
      tests.set(key, { classname, name, status, files: [file], runs: 1, flaky });
      continue;
    }
    seen.runs += 1;
    seen.flaky ||= flaky;
    if (!seen.files.includes(file)) seen.files.push(file);
    if (MERGE_RANK[status] > MERGE_RANK[seen.status]) seen.status = status;
  }
  return [...tests.values()];
}

export function evaluate(catalog: Catalog, cases: readonly TestCase[]): Evaluation {
  const tests = mergeTests(cases);
  const ids = new Set(catalog.areas.flatMap((area) => area.items.map((item) => item.id)));

  const tagged = new Map<string, Test[]>();
  const orphans = new Map<string, Test[]>();
  for (const test of tests) {
    for (const tag of findTags(test.name)) {
      append(ids.has(tag) ? tagged : orphans, tag, test);
    }
  }

  const byName = new Map<string, Test[]>();
  for (const test of tests) append(byName, test.name, test);

  const areas = catalog.areas.map((area): AreaResult => {
    const items = area.items.map((item) => judge(item, tagged, byName));
    return {
      id: area.id,
      title: area.title,
      ...progress(items),
      dropped: items.filter((item) => item.status === "dropped").length,
      items,
    };
  });

  return {
    ...progress(areas.flatMap((area) => area.items)),
    areas,
    orphans: [...orphans].map(([tag, list]) => ({ tag, tests: list })),
    tests,
  };
}

function judge(
  item: CatalogItem,
  tagged: ReadonlyMap<string, Test[]>,
  byName: ReadonlyMap<string, Test[]>,
): ItemResult {
  const result: ItemResult = {
    id: item.id,
    title: item.title,
    evidence: item.evidence,
    status: "no-tests",
    tests: [],
    missing: [],
  };

  if (item.evidence === "manual") {
    result.status = item.done ? "done" : "not-done";
  } else {
    const linked = new Set(tagged.get(item.id));
    for (const selector of item.tests ?? []) {
      const found = (byName.get(selector.name) ?? []).filter(
        (test) => selector.classname === undefined || test.classname === selector.classname,
      );
      if (found.length === 0) result.missing.push(selector);
      for (const test of found) linked.add(test);
    }
    result.tests = [...linked];
    result.status = junitStatus(result.tests, result.missing.length > 0);
  }

  if (item.dropped !== undefined) {
    result.status = "dropped";
    result.dropped = item.dropped;
  }
  return result;
}

/** The most serious reason first: a failure, then a test not found, then a skip. */
function junitStatus(tests: readonly Test[], missing: boolean): ItemStatus {
  if (tests.some((test) => test.status === "failed" || test.status === "error")) return "failed";
  if (missing) return "missing-tests";
  if (tests.some((test) => test.status === "skipped")) return "skipped";
  return tests.length === 0 ? "no-tests" : "done";
}

export function progress(items: readonly ItemResult[]): Progress {
  const counted = items.filter((item) => item.status !== "dropped");
  const done = counted.filter((item) => item.status === "done").length;
  const total = counted.length;
  // Rounded down: 199 of 200 is 99 %, not 100 %.
  const percent = total === 0 ? null : Math.floor((done * 100) / total);
  return { done, total, percent };
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}
