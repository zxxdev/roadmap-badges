import { describe, expect, it } from "vitest";
import type { Catalog, CatalogItem } from "../src/catalog/schema.js";
import { evaluate, findTags, mergeTests, type ItemResult } from "../src/evidence/evaluate.js";
import type { TestCase, TestStatus } from "../src/evidence/junit.js";

/** A test case from reports/junit.xml unless another file is given. */
function test(
  name: string,
  status: TestStatus = "passed",
  more: Partial<Omit<TestCase, "name" | "status">> = {},
): TestCase {
  return {
    file: "reports/junit.xml",
    suite: "suite",
    classname: "tests/api.test.ts",
    name,
    status,
    flaky: false,
    ...more,
  };
}

function junit(id: string, more: Partial<Extract<CatalogItem, { evidence: "junit" }>> = {}) {
  return { id, title: `Title of ${id}`, evidence: "junit" as const, ...more };
}

function manual(id: string, done: boolean) {
  return { id, title: `Title of ${id}`, evidence: "manual" as const, done };
}

/** A catalog with a single area holding the given items. */
function catalog(...items: CatalogItem[]): Catalog {
  return { project: "demo", areas: [{ id: "api", title: "API", items }] };
}

/** The status of each item, by id. */
function statuses(result: ReturnType<typeof evaluate>): Record<string, ItemResult["status"]> {
  return Object.fromEntries(
    result.areas.flatMap((area) => area.items).map((item) => [item.id, item.status]),
  );
}

describe("evaluate: when a junit item is done @evidence.progress", () => {
  it("is done with one linked test that passes", () => {
    const result = evaluate(catalog(junit("api.get")), [test("gets a user @api.get")]);

    expect(statuses(result)).toEqual({ "api.get": "done" });
    expect(result.areas[0]).toMatchObject({ done: 1, total: 1, percent: 100 });
  });

  it("is not done when one of its two tests fails", () => {
    const result = evaluate(catalog(junit("api.get")), [
      test("gets a user @api.get"),
      test("returns 404 for a missing user @api.get", "failed"),
    ]);

    expect(statuses(result)).toEqual({ "api.get": "failed" });
    expect(result.areas[0]).toMatchObject({ done: 0, total: 1, percent: 0 });
  });

  it("is not done when its test ends in an error", () => {
    const result = evaluate(catalog(junit("api.get")), [test("gets a user @api.get", "error")]);
    expect(statuses(result)).toEqual({ "api.get": "failed" });
  });

  it("is not done when its test is skipped", () => {
    const result = evaluate(catalog(junit("api.get")), [test("gets a user @api.get", "skipped")]);
    expect(statuses(result)).toEqual({ "api.get": "skipped" });
  });

  it("is not done when no test is linked to it", () => {
    const result = evaluate(catalog(junit("api.get")), [test("something else")]);

    expect(statuses(result)).toEqual({ "api.get": "no-tests" });
    expect(result.percent).toBe(0);
  });

  it("is not done when there are no reports at all", () => {
    expect(statuses(evaluate(catalog(junit("api.get")), []))).toEqual({ "api.get": "no-tests" });
  });

  it("gives the most serious reason: a failure before a skip", () => {
    const result = evaluate(catalog(junit("api.get")), [
      test("one @api.get", "skipped"),
      test("two @api.get", "failed"),
    ]);
    expect(statuses(result)).toEqual({ "api.get": "failed" });
  });

  it("counts a test that passed on a retry as passed, and keeps it marked flaky", () => {
    const result = evaluate(catalog(junit("api.get")), [
      test("gets a user @api.get", "passed", { flaky: true }),
    ]);

    expect(statuses(result)).toEqual({ "api.get": "done" });
    expect(result.areas[0]?.items[0]?.tests[0]?.flaky).toBe(true);
  });
});

describe("evaluate: tests that appear more than once @evidence.progress", () => {
  it("is not done when the same test passes in one report and fails in another", () => {
    const result = evaluate(catalog(junit("api.get")), [
      test("gets a user @api.get", "passed", { file: "linux.xml" }),
      test("gets a user @api.get", "failed", { file: "windows.xml" }),
    ]);

    expect(statuses(result)).toEqual({ "api.get": "failed" });
    expect(result.areas[0]?.items[0]?.tests).toEqual([
      {
        classname: "tests/api.test.ts",
        name: "gets a user @api.get",
        status: "failed",
        files: ["linux.xml", "windows.xml"],
        runs: 2,
        flaky: false,
      },
    ]);
  });

  it("counts a test as passed when it passes on one system and is skipped on another", () => {
    const result = evaluate(catalog(junit("api.get")), [
      test("reads the registry @api.get", "skipped", { file: "linux.xml" }),
      test("reads the registry @api.get", "passed", { file: "windows.xml" }),
    ]);
    expect(statuses(result)).toEqual({ "api.get": "done" });
  });

  it("treats tests with the same name in different classnames as different tests", () => {
    const merged = mergeTests([
      test("works", "passed", { classname: "a" }),
      test("works", "failed", { classname: "b" }),
    ]);
    expect(merged.map(({ classname, status, runs }) => ({ classname, status, runs }))).toEqual([
      { classname: "a", status: "passed", runs: 1 },
      { classname: "b", status: "failed", runs: 1 },
    ]);
  });

  it("counts every run of a test repeated in the same report", () => {
    const [merged] = mergeTests([test("retried"), test("retried", "failed"), test("retried")]);
    expect(merged).toMatchObject({ status: "failed", runs: 3, files: ["reports/junit.xml"] });
  });
});

describe("evaluate: totals and percentages @evidence.progress", () => {
  it("rounds down, so only a finished area shows 100 %", () => {
    const result = evaluate(catalog(junit("a"), junit("b"), junit("c")), [
      test("@a"),
      test("@b"),
    ]);
    expect(result.areas[0]).toMatchObject({ done: 2, total: 3, percent: 66 });
  });

  it("leaves a dropped item out of the total even when its test passes", () => {
    const result = evaluate(
      catalog(junit("api.get"), junit("api.export", { dropped: "Replaced by reports" })),
      [test("@api.get", "failed"), test("@api.export")],
    );

    expect(statuses(result)).toEqual({ "api.get": "failed", "api.export": "dropped" });
    expect(result.areas[0]).toMatchObject({ done: 0, total: 1, dropped: 1, percent: 0 });
    expect(result.areas[0]?.items[1]?.dropped).toBe("Replaced by reports");
  });

  it("gives no percentage for an area with no items, instead of 0 % or 100 %", () => {
    const result = evaluate({ project: "demo", areas: [{ id: "later", title: "Later", items: [] }] }, []);

    expect(result.areas[0]).toMatchObject({ done: 0, total: 0, percent: null });
    expect(result.percent).toBeNull();
  });

  it("gives no percentage for an area whose items are all dropped", () => {
    const result = evaluate(catalog(junit("a", { dropped: "Not needed" })), [test("@a")]);
    expect(result.areas[0]).toMatchObject({ done: 0, total: 0, dropped: 1, percent: null });
  });

  it("adds up every area for the project's total", () => {
    const result = evaluate(
      {
        project: "demo",
        areas: [
          { id: "one", title: "One", items: [junit("one.a"), junit("one.b")] },
          { id: "two", title: "Two", items: [junit("two.a")] },
          { id: "three", title: "Three", items: [] },
        ],
      },
      [test("@one.a"), test("@two.a")],
    );

    expect(result.areas.map((area) => area.percent)).toEqual([50, 100, null]);
    expect(result).toMatchObject({ done: 2, total: 3, percent: 66 });
  });
});

describe("evaluate: manual items @evidence.manual", () => {
  it("uses the done flag of a manual item", () => {
    const result = evaluate(catalog(manual("docs.guide", true), manual("docs.faq", false)), []);

    expect(statuses(result)).toEqual({ "docs.guide": "done", "docs.faq": "not-done" });
    expect(result.areas[0]).toMatchObject({ done: 1, total: 2, percent: 50 });
  });

  it("ignores tests tagged with a manual item's id, without calling the tag an orphan", () => {
    const result = evaluate(catalog(manual("docs.guide", false)), [test("@docs.guide")]);

    expect(statuses(result)).toEqual({ "docs.guide": "not-done" });
    expect(result.orphans).toEqual([]);
  });
});

describe("evaluate: linking items to tests @evidence.link", () => {
  it("links each test to its own item when one id starts with the other", () => {
    const result = evaluate(catalog(junit("api.get"), junit("api.get-all")), [
      test("gets one user @api.get", "failed"),
      test("gets every user @api.get-all"),
    ]);

    expect(statuses(result)).toEqual({ "api.get": "failed", "api.get-all": "done" });
    expect(result.areas[0]?.items[1]?.tests.map((linked) => linked.name)).toEqual([
      "gets every user @api.get-all",
    ]);
  });

  it("links one test to every item it tags", () => {
    const result = evaluate(catalog(junit("api.get"), junit("api.list")), [
      test("@api.get @api.list share a handler"),
    ]);
    expect(statuses(result)).toEqual({ "api.get": "done", "api.list": "done" });
  });

  it("links a test by a selector with its name", () => {
    const result = evaluate(catalog(junit("api.get", { tests: [{ name: "test_get_user" }] })), [
      test("test_get_user", "passed", { classname: "tests.test_api" }),
    ]);
    expect(statuses(result)).toEqual({ "api.get": "done" });
  });

  it("uses the selector's classname to tell apart tests with the same name", () => {
    const item = junit("api.get", { tests: [{ name: "works", classname: "users" }] });
    const result = evaluate(catalog(item), [
      test("works", "failed", { classname: "orders" }),
      test("works", "passed", { classname: "users" }),
    ]);

    expect(statuses(result)).toEqual({ "api.get": "done" });
    expect(result.areas[0]?.items[0]?.tests.map((linked) => linked.classname)).toEqual(["users"]);
  });

  it("is not done when a selected test is in no report, and says which one", () => {
    const item = junit("api.get", {
      tests: [{ name: "test_get_user" }, { name: "test_get_admin", classname: "tests.test_api" }],
    });
    const result = evaluate(catalog(item), [test("test_get_user")]);

    expect(statuses(result)).toEqual({ "api.get": "missing-tests" });
    expect(result.areas[0]?.items[0]?.missing).toEqual([
      { name: "test_get_admin", classname: "tests.test_api" },
    ]);
  });

  it("does not count a selector as found when only the classname differs", () => {
    const item = junit("api.get", { tests: [{ name: "works", classname: "users" }] });
    const result = evaluate(catalog(item), [test("works", "passed", { classname: "orders" })]);
    expect(statuses(result)).toEqual({ "api.get": "missing-tests" });
  });

  it("joins the tests found by tag and by selector, once each", () => {
    const item = junit("api.get", { tests: [{ name: "gets a user @api.get" }, { name: "plain" }] });
    const result = evaluate(catalog(item), [test("gets a user @api.get"), test("plain", "skipped")]);

    expect(result.areas[0]?.items[0]?.tests.map((linked) => linked.name)).toEqual([
      "gets a user @api.get",
      "plain",
    ]);
    expect(statuses(result)).toEqual({ "api.get": "skipped" });
  });

  it("reports tags that match no item as orphans, with their tests", () => {
    const result = evaluate(catalog(junit("api.get")), [
      test("gets a user @api.gte"),
      test("also @api.gte"),
      test("@area.only"),
    ]);

    expect(result.orphans.map(({ tag, tests }) => [tag, tests.length])).toEqual([
      ["api.gte", 2],
      ["area.only", 1],
    ]);
    expect(statuses(result)).toEqual({ "api.get": "no-tests" });
  });
});

describe("findTags @evidence.link", () => {
  it.each([
    ["gets a user @api.get", ["api.get"]],
    ["@api.get at the start", ["api.get"]],
    ["ends a sentence @api.get.", ["api.get"]],
    ["in brackets (@api.get) and [@api.list]", ["api.get", "api.list"]],
    ["repeated @api.get and @api.get", ["api.get"]],
    ["describe > test @api.get-all", ["api.get-all"]],
    ["mail user@example.com is not a tag", []],
    ["upper case @API.get is not a tag", []],
    ["a mixed-case end @api.Get is not a tag", []],
    ["an underscore @api_get is not a tag", []],
    ["a lone @ sign", []],
  ])("finds the tags in %j", (name, tags) => {
    expect(findTags(name)).toEqual(tags);
  });
});
