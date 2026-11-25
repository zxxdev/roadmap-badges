/**
 * The action's logic, kept apart from the GitHub Actions toolkit so it can be
 * tested with a fake runner: index.ts passes the real one.
 *
 * For now it reads and checks the catalog. Reading test results and drawing
 * the badges come in the next versions.
 */
import { formatError, parseCatalog } from "./catalog/parse.js";
import type { Catalog } from "./catalog/schema.js";

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
  /** Logs an error and, with a location, shows it on that line of the file. */
  error(message: string, location?: FileLocation): void;
  setOutput(name: string, value: string): void;
  /** Appends Markdown to the job summary shown on the workflow run's page. */
  addSummary(markdown: string): Promise<void>;
  /** The file's text, or undefined if there is no such file. */
  readFile(path: string): string | undefined;
  setFailed(message: string): void;
}

export const DEFAULT_CATALOG = "progress.yml";

export async function run(runner: Runner): Promise<void> {
  try {
    const path = runner.getInput("catalog").trim() || DEFAULT_CATALOG;
    const text = runner.readFile(path);
    if (text === undefined) {
      runner.setFailed(
        `roadmap-badges: no catalog at ${path}. Create it, or set the "catalog" input to its path.`,
      );
      await runner.addSummary(`${HEADING}No catalog at ${codeSpan(path)}.\n`);
      return;
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
      return;
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
    await runner.addSummary(summary(path, result.catalog));
  } catch (error) {
    runner.setFailed(error instanceof Error ? error.message : String(error));
  }
}

/** Items that count towards the total, and dropped items, which do not. */
export function countItems(catalog: Catalog): { areas: number; items: number; dropped: number } {
  const all = catalog.areas.flatMap((area) => area.items);
  const dropped = all.filter((item) => item.dropped !== undefined).length;
  return { areas: catalog.areas.length, items: all.length - dropped, dropped };
}

const HEADING = "### Roadmap Badges\n\n";

function summary(path: string, catalog: Catalog): string {
  const rows = catalog.areas.map((area) => {
    const dropped = area.items.filter((item) => item.dropped !== undefined).length;
    return `| ${tableCell(area.title)} | ${String(area.items.length - dropped)} | ${String(dropped)} |`;
  });
  return (
    `${HEADING}Catalog ${codeSpan(path)} for **${tableCell(catalog.project)}**.\n\n` +
    "| Area | Items | Dropped |\n| --- | ---: | ---: |\n" +
    rows.join("\n") +
    "\n"
  );
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
    .replace(/[\\|*_`[\]]/g, (char) => `\\${char}`);
}
