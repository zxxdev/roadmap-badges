import { describe, expect, it } from "vitest";
import { formatError, parseCatalog, type CatalogError } from "../src/catalog/parse.js";

/** Joins lines into a YAML document, so tests can show the file as it reads. */
const yaml = (...lines: string[]) => lines.join("\n") + "\n";

const VALID = yaml(
  "project: demo",
  "areas:",
  "  - id: api",
  "    title: API",
  "    items:",
  "      - id: api.get-user",
  "        title: Get a user",
  "        evidence: junit",
  "      - id: api.export",
  "        title: Export to CSV",
  "        evidence: junit",
  "        tests:",
  "          - name: exports users",
  "            classname: tests/export.test.ts",
  "        dropped: Replaced by the reports area",
  "  - id: docs",
  "    title: Docs",
  "    items:",
  "      - id: docs.guide",
  "        title: User guide written",
  "        evidence: manual",
  "        done: false",
);

/** The errors of a catalog that must be invalid. */
function errorsOf(text: string): CatalogError[] {
  const result = parseCatalog(text);
  if (result.ok) throw new Error("expected the catalog to be invalid");
  return result.errors;
}

describe("parseCatalog @catalog.read", () => {
  it("reads a valid catalog with junit, manual and dropped items", () => {
    const result = parseCatalog(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.project).toBe("demo");
    expect(result.catalog.areas.map((area) => area.id)).toEqual(["api", "docs"]);
    expect(result.catalog.areas[0]?.items[1]).toEqual({
      id: "api.export",
      title: "Export to CSV",
      evidence: "junit",
      tests: [{ name: "exports users", classname: "tests/export.test.ts" }],
      dropped: "Replaced by the reports area",
    });
    expect(result.catalog.areas[1]?.items[0]).toMatchObject({ evidence: "manual", done: false });
  });

  it("accepts an area with no items yet", () => {
    const result = parseCatalog(
      yaml("project: demo", "areas:", "  - id: api", "    title: API", "    items: []"),
    );
    expect(result.ok).toBe(true);
  });

  it("trims titles and reasons", () => {
    const result = parseCatalog(VALID.replace("title: API", 'title: "  API  "'));
    expect(result.ok && result.catalog.areas[0]?.title).toBe("API");
  });

  it("reads Windows line endings and a byte order mark", () => {
    const result = parseCatalog("﻿" + VALID.replaceAll("\n", "\r\n"));
    expect(result.ok).toBe(true);
  });

  it("does not count a byte order mark as a column", () => {
    const errors = errorsOf("﻿" + VALID.replace("project: demo", "project: 7"));
    expect(errors).toEqual([
      { line: 1, column: 10, field: "project", message: "must be text, not 7" },
    ]);
  });

  it("reports YAML syntax errors with their position and nothing else", () => {
    const errors = errorsOf(yaml("project: demo", "areas:", "  - id: api", "   title: [unclosed"));
    expect(errors.map((error) => [error.line, error.column, error.field])).toEqual([
      [4, 1, ""],
      [5, 1, ""],
    ]);
    expect(errors.every((error) => error.message.startsWith("invalid YAML: "))).toBe(true);
  });

  it("says an item or an area must be a mapping when it is not", () => {
    const errors = errorsOf(
      VALID.replace(
        "      - id: docs.guide\n        title: User guide written\n        evidence: manual\n        done: false\n",
        "      - just text\n      -\n",
      ).replace("    items:\n      - id: api.get-user", "    items: none\n    extra:\n      - id: api.get-user"),
    );
    expect(errors.map((error) => [error.field, error.message])).toEqual([
      ["areas[0].items", 'must be a list, not "none"'],
      ["areas[0].extra", "unknown field"],
      ["areas[1].items[0]", 'must be a mapping, not "just text"'],
      ["areas[1].items[1]", "must be a mapping, not empty"],
    ]);
  });

  it("reports a key written twice", () => {
    const errors = errorsOf(yaml("project: demo", "project: again", "areas: []"));
    expect(errors[0]).toMatchObject({ line: 2, column: 1 });
    expect(errors[0]?.message).toMatch(/^invalid YAML: .*unique/i);
  });

  it("explains that an empty file is not a catalog", () => {
    expect(errorsOf("")).toEqual([
      {
        line: 1,
        column: 1,
        field: "",
        message: 'the catalog must be a mapping with "project" and "areas"',
      },
    ]);
  });

  it("points a missing field at the mapping that lacks it", () => {
    const errors = errorsOf(VALID.replace("        title: Get a user\n", ""));
    expect(errors).toEqual([
      { line: 6, column: 9, field: "areas[0].items[0].title", message: "missing required field" },
    ]);
  });

  it("points an unknown field at the key itself, with a hint for fields of the other kind", () => {
    const errors = errorsOf(
      VALID.replace(
        "        evidence: junit\n      - id: api.export",
        "        evidence: junit\n        done: true\n      - id: api.export",
      ).replace("    title: Docs", "    title: Docs\n    colour: blue"),
    );
    expect(errors).toEqual([
      {
        line: 9,
        column: 9,
        field: "areas[0].items[0].done",
        message: "unknown field (only manual items have it)",
      },
      { line: 19, column: 5, field: "areas[1].colour", message: "unknown field" },
    ]);
  });

  it("says which evidence types exist when it is missing or misspelt", () => {
    const missing = errorsOf(VALID.replace("        evidence: manual\n", ""));
    expect(missing).toEqual([
      {
        line: 19,
        column: 9,
        field: "areas[1].items[0].evidence",
        message: 'missing required field; must be "junit" or "manual"',
      },
    ]);
    const misspelt = errorsOf(VALID.replace("evidence: manual", "evidence: manaul"));
    expect(misspelt[0]).toMatchObject({
      line: 21,
      column: 19,
      message: 'must be "junit" or "manual", not "manaul"',
    });
  });

  it("names the expected type and what it found instead", () => {
    const errors = errorsOf(VALID.replace("done: false", "done: yes"));
    // YAML 1.2 reads "yes" as text, not as true: the catalog must say true or false.
    expect(errors).toEqual([
      {
        line: 22,
        column: 15,
        field: "areas[1].items[0].done",
        message: 'must be true or false, not "yes"',
      },
    ]);
  });

  it("rejects ids that tests could not link to", () => {
    for (const bad of ["API", "api get", "api..get", "-api", "api@get", "a".repeat(65)]) {
      const errors = errorsOf(VALID.replace("id: api.get-user", `id: "${bad}"`));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ line: 6, column: 13, field: "areas[0].items[0].id" });
    }
  });

  it("rejects empty titles and empty lists", () => {
    const errors = errorsOf(
      VALID.replace("title: Get a user", 'title: "   "').replace(
        "        tests:\n          - name: exports users\n            classname: tests/export.test.ts\n",
        "        tests: []\n",
      ),
    );
    expect(errors.map((error) => [error.field, error.message])).toEqual([
      ["areas[0].items[0].title", "must not be empty"],
      ["areas[0].items[1].tests", "needs at least one test, or leave it out to link by @<id> tag"],
    ]);
  });

  it("rejects a catalog with no areas", () => {
    expect(errorsOf(yaml("project: demo", "areas: []"))).toEqual([
      { line: 2, column: 8, field: "areas", message: "needs at least one area" },
    ]);
  });

  it("reports duplicate ids, item ids across areas too, with the first line", () => {
    const errors = errorsOf(
      VALID.replace("id: api.export", "id: api.get-user")
        .replace("  - id: docs", "  - id: api")
        .replace("id: docs.guide", "id: api.get-user"),
    );
    expect(errors).toEqual([
      {
        line: 9,
        column: 13,
        field: "areas[0].items[1].id",
        message: 'duplicate item id "api.get-user", first used at line 6',
      },
      {
        line: 16,
        column: 9,
        field: "areas[1].id",
        message: 'duplicate area id "api", first used at line 3',
      },
      {
        line: 19,
        column: 13,
        field: "areas[1].items[0].id",
        message: 'duplicate item id "api.get-user", first used at line 6',
      },
    ]);
  });

  it("reports every problem at once, in the order they appear in the file", () => {
    const errors = errorsOf(
      VALID.replace("project: demo", "project: 7")
        .replace("title: Docs", "title: [Docs]")
        .replace("id: docs.guide", "id: api.get-user"),
    );
    expect(errors.map((error) => error.line)).toEqual([1, 17, 19]);
  });

  it("refuses a file that repeats aliases to blow up in memory", () => {
    const bomb = yaml(
      "a: &a [x, x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "project: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
    );
    const errors = errorsOf(bomb);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/alias/i);
  });
});

describe("formatError @catalog.read", () => {
  it("writes file, line, column, field and message", () => {
    const error = { line: 7, column: 9, field: "areas[0].title", message: "must not be empty" };
    expect(formatError("progress.yml", error)).toBe(
      "progress.yml:7:9 areas[0].title: must not be empty",
    );
  });

  it("leaves the field out for problems with the whole file", () => {
    const error = { line: 1, column: 1, field: "", message: "invalid YAML: oops" };
    expect(formatError("progress.yml", error)).toBe("progress.yml:1:1 invalid YAML: oops");
  });
});
