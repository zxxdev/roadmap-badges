/**
 * The action's logic, kept apart from the GitHub Actions toolkit so it can be
 * tested with a fake runner: index.ts passes the real one.
 *
 * It reads the catalog and the JUnit reports, decides which items are done and
 * reports the progress of each area. Drawing the badges comes next.
 */
import { normalize } from "node:path";
import { formatError, parseCatalog } from "./catalog/parse.js";
import type { Catalog } from "./catalog/schema.js";
import { evaluate, type Evaluation, type ItemResult, type Test } from "./evidence/evaluate.js";
import { parseJUnitReport, ReportError, type TestCase } from "./evidence/junit.js";

/** A place in a file, for annotations on the pull request. Line and column start at 1. */
export interface FileLocation {
  file: string;
  line: number;
  column: number;
}

/** What the action needs from the runner. */
export interface Runner {
  getInput(name: string): string;
  info(message: string): void;
  /** Logs a warning and, with a location, shows it on that line of the file. */
  warning(message: string, location?: FileLocation): void;
  /** Logs an error and, with a location, shows it on that line of the file. */
  error(message: string, location?: FileLocation): void;
  setOutput(name: string, value: string): void;
  /** Appends Markdown to the job summary shown on the workflow run's page. */
  addSummary(markdown: string): Promise<void>;
  /** The file's text, or undefined if there is no such file. */
  readFile(path: string): string | undefined;
  /** The files that match a glob pattern, sorted. */
  findFiles(pattern: string): string[];
  setFailed(message: string): void;
}

export const DEFAULT_CATALOG = "progress.yml";

const HEADING = "### Roadmap Badges\n\n";

export async function run(runner: Runner): Promise<void> {
  try {
    const path = runner.getInput("catalog").trim() || DEFAULT_CATALOG;
    const strict = booleanInput(runner, "strict");
    const patterns = runner
      .getInput("reports")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    const catalog = await readCatalog(runner, path);
    if (catalog === undefined) return;

    if (patterns.length === 0 && needsReports(catalog)) {
      const message =
        "roadmap-badges: the catalog has items proved by tests, but no reports were given. " +
        'Set the "reports" input to the JUnit XML files that your tests write.';
      runner.setFailed(message);
      await runner.addSummary(`${HEADING}${message.replace("roadmap-badges: t", "T")}\n`);
      return;
    }

    const reports = await readReports(runner, patterns);
    if (reports === undefined) return;

    const result = evaluate(catalog, reports.cases);
    for (const { tag, tests } of result.orphans) {
      const message = orphanMessage(tag, tests);
      if (strict) runner.error(message);
      else runner.warning(message);
    }

    if (patterns.length > 0) {
      runner.info(
        `roadmap-badges: read ${plural(result.tests.length, "test")} from ` +
          `${plural(reports.files, "report")}.`,
      );
    }
    runner.info(`roadmap-badges: ${progressText(result)}.`);
    runner.setOutput("done", String(result.done));
    runner.setOutput("percent", result.percent === null ? "" : String(result.percent));
    await runner.addSummary(summary(path, catalog, result, reports.files));

    if (strict && result.orphans.length > 0) {
      runner.setFailed(
        `roadmap-badges: ${plural(result.orphans.length, "tag")} in test names ` +
          `${result.orphans.length === 1 ? "matches" : "match"} no item, and "strict" is on.`,
      );
    }
  } catch (error) {
    runner.setFailed(error instanceof Error ? error.message : String(error));
  }
}

/** Reads and checks the catalog. On a problem it fails the step and returns undefined. */
async function readCatalog(runner: Runner, path: string): Promise<Catalog | undefined> {
  const text = runner.readFile(path);
  if (text === undefined) {
    runner.setFailed(
      `roadmap-badges: no catalog at ${path}. Create it, or set the "catalog" input to its path.`,
    );
    await runner.addSummary(`${HEADING}No catalog at ${codeSpan(path)}.\n`);
    return undefined;
  }

  const result = parseCatalog(text);
  if (!result.ok) {
    const lines = result.errors.map((error) => formatError(path, error));
    result.errors.forEach((error, index) => {
      runner.error(lines[index] ?? error.message, {
        file: path,
        line: error.line,
        column: error.column,
      });
    });
    const count = plural(result.errors.length, "problem");
    runner.setFailed(`roadmap-badges: the catalog at ${path} has ${count}.`);
    await runner.addSummary(
      `${HEADING}The catalog at ${codeSpan(path)} has ${count}:\n\n` +
        lines.map((line) => `- ${codeSpan(line)}`).join("\n") +
        "\n",
    );
    return undefined;
  }

  const counts = countItems(result.catalog);
  runner.info(
    `roadmap-badges: read ${path} for ${result.catalog.project}: ` +
      `${plural(counts.areas, "area")}, ${plural(counts.items, "item")}` +
      (counts.dropped > 0 ? ` and ${String(counts.dropped)} dropped.` : "."),
  );
  runner.setOutput("areas", String(counts.areas));
  runner.setOutput("items", String(counts.items));
  runner.setOutput("dropped", String(counts.dropped));
  return result.catalog;
}

/**
 * Reads every report that the patterns match. A pattern that matches nothing
 * is an error, not 0 %: a silent 0 % from a mistyped path is worse than a red
 * build. On a problem it fails the step and returns undefined.
 */
async function readReports(
  runner: Runner,
  patterns: readonly string[],
): Promise<{ cases: TestCase[]; files: number } | undefined> {
  const problems: string[] = [];
  const problem = (message: string, location?: FileLocation) => {
    problems.push(message);
    runner.error(`roadmap-badges: ${message}`, location);
  };

  // "reports/a.xml" and "./reports/a.xml" are the same file: read it once.
  const files: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const found = runner.findFiles(pattern);
    if (found.length === 0) problem(`no file matches the reports pattern ${pattern}`);
    for (const file of found) {
      if (seen.has(normalize(file))) continue;
      seen.add(normalize(file));
      files.push(file);
    }
  }

  const cases: TestCase[] = [];
  for (const file of files) {
    const text = runner.readFile(file);
    if (text === undefined) {
      problem(`cannot read ${file}`);
      continue;
    }
    try {
      const read = parseJUnitReport(text, file);
      if (read.length === 0) runner.warning(`roadmap-badges: ${file} has no test cases.`);
      cases.push(...read);
    } catch (error) {
      if (!(error instanceof ReportError)) throw error;
      const { line, column } = error;
      problem(error.message, line === undefined ? undefined : { file, line, column: column ?? 1 });
    }
  }

  if (problems.length === 0) return { cases, files: files.length };

  const count = plural(problems.length, "problem");
  runner.setFailed(`roadmap-badges: ${count} with the test reports.`);
  await runner.addSummary(
    `${HEADING}${count} with the test reports:\n\n` +
      problems.map((problem) => `- ${codeSpan(problem)}`).join("\n") +
      "\n",
  );
  return undefined;
}

/** Items that count towards the total, and dropped items, which do not. */
export function countItems(catalog: Catalog): { areas: number; items: number; dropped: number } {
  const all = catalog.areas.flatMap((area) => area.items);
  const dropped = all.filter((item) => item.dropped !== undefined).length;
  return { areas: catalog.areas.length, items: all.length - dropped, dropped };
}

/** True when some item that counts is proved by tests, so reports are needed. */
function needsReports(catalog: Catalog): boolean {
  return catalog.areas.some((area) =>
    area.items.some((item) => item.evidence === "junit" && item.dropped === undefined),
  );
}

/** A true/false input, read like the toolkit's getBooleanInput. Empty means false. */
function booleanInput(runner: Runner, name: string): boolean {
  const value = runner.getInput(name).trim();
  if (["", "false", "False", "FALSE"].includes(value)) return false;
  if (["true", "True", "TRUE"].includes(value)) return true;
  throw new Error(`roadmap-badges: the "${name}" input must be true or false, not "${value}".`);
}

function orphanMessage(tag: string, tests: readonly Test[]): string {
  const first = tests[0];
  const where =
    first === undefined ? "" : ` in "${shorten(first.name)}" (${first.files.join(", ")})`;
  const more = tests.length > 1 ? ` and ${plural(tests.length - 1, "more test")}` : "";
  return `roadmap-badges: the tag @${tag}${where}${more} matches no item in the catalog. Is the id misspelt?`;
}

function progressText({ done, total, percent }: Evaluation): string {
  return percent === null
    ? "no items to count"
    : `${String(done)} of ${plural(total, "item")} done (${String(percent)}%)`;
}

function summary(path: string, catalog: Catalog, result: Evaluation, reports: number): string {
  const rows = result.areas.map(
    (area) =>
      `| ${tableCell(area.title)} | ${String(area.done)} | ${String(area.total)} | ` +
      `${area.percent === null ? "no items" : `${String(area.percent)}%`} | ${String(area.dropped)} |`,
  );
  const source =
    reports === 0
      ? `Catalog ${codeSpan(path)}, no test reports.`
      : `Catalog ${codeSpan(path)}, ${plural(reports, "JUnit report")} with ${plural(result.tests.length, "test")}.`;

  let text =
    `${HEADING}**${tableCell(catalog.project)}**: ${progressText(result)}. ${source}\n\n` +
    "| Area | Done | Items | Progress | Dropped |\n| --- | ---: | ---: | ---: | ---: |\n" +
    rows.join("\n") +
    "\n";

  const missing = result.areas.flatMap((area) =>
    area.items
      .filter((item) => item.status !== "done" && item.status !== "dropped")
      .map(
        (item) =>
          `| \`${item.id}\` ${tableCell(item.title)} | ${tableCell(area.title)} | ${tableCell(why(item))} |`,
      ),
  );
  if (missing.length > 0) {
    text +=
      `\n<details><summary>${plural(missing.length, "item")} not done</summary>\n\n` +
      "| Item | Area | Why |\n| --- | --- | --- |\n" +
      missing.join("\n") +
      "\n\n</details>\n";
  }

  const notes: string[] = [];
  if (result.orphans.length > 0) {
    const tags = result.orphans.map(({ tag }) => `\`@${tag}\``).join(", ");
    notes.push(`Tags that match no item: ${tags}.`);
  }
  const repeated = result.tests.filter((test) => test.runs > 1).length;
  if (repeated > 0) {
    notes.push(
      `${plural(repeated, "test")} ${repeated === 1 ? "appears" : "appear"} more than once; ` +
        "a failure in any run counts, and a pass counts over a skip.",
    );
  }
  const flaky = result.tests.filter((test) => test.flaky).length;
  if (flaky > 0) {
    notes.push(`${plural(flaky, "test")} passed only after a retry.`);
  }
  if (notes.length > 0) text += `\n${notes.map((note) => `- ${note}`).join("\n")}\n`;
  return text;
}

/** Why an item is not done, in a few words. */
function why(item: ItemResult): string {
  const names = (tests: readonly { name: string }[]) => {
    const [first, ...rest] = tests;
    if (first === undefined) return "";
    return `"${shorten(first.name)}"${rest.length > 0 ? ` and ${String(rest.length)} more` : ""}`;
  };
  switch (item.status) {
    case "failed":
      return `failed: ${names(item.tests.filter((test) => test.status === "failed" || test.status === "error"))}`;
    case "missing-tests":
      return `not in any report: ${names(item.missing)}`;
    case "skipped":
      return `skipped: ${names(item.tests.filter((test) => test.status === "skipped"))}`;
    case "no-tests":
      return `no test is tagged @${item.id}`;
    case "not-done":
      return "marked as not done";
    case "done":
    case "dropped":
      return "";
  }
}

function shorten(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** Text inside a code span: no backticks, and on one line. */
function codeSpan(text: string): string {
  return "`" + text.replaceAll("`", "'").replace(/\s+/g, " ") + "`";
}

/**
 * Catalog text inside a Markdown table cell: on one line, with the characters
 * that would end the cell, start HTML or format the text escaped.
 */
export function tableCell(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\|*_`[\]$~]/g, (char) => `\\${char}`);
}
