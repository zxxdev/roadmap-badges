/**
 * The action's logic, kept apart from the GitHub Actions toolkit so it can be
 * tested with a fake runner: index.ts passes the real one.
 *
 * For now it only looks for the catalog and says what it found. Reading the
 * catalog, the test results and drawing the badges come in the next versions.
 */

/** What the action needs from the runner. */
export interface Runner {
  getInput(name: string): string;
  info(message: string): void;
  setOutput(name: string, value: string): void;
  /** Appends Markdown to the job summary shown on the workflow run's page. */
  addSummary(markdown: string): Promise<void>;
  fileExists(path: string): boolean;
  setFailed(message: string): void;
}

export const DEFAULT_CATALOG = "progress.yml";

/** The catalog path for the summary: inside a code span, so no backticks. */
function codeSpan(text: string): string {
  return "`" + text.replaceAll("`", "'") + "`";
}

export async function run(runner: Runner): Promise<void> {
  try {
    const catalog = runner.getInput("catalog").trim() || DEFAULT_CATALOG;
    const found = runner.fileExists(catalog);
    const message = found
      ? `Found the catalog at ${catalog}. Reading it comes in a later version.`
      : `No catalog at ${catalog} yet.`;

    runner.info(`roadmap-badges: ${message}`);
    runner.setOutput("catalog-found", String(found));
    await runner.addSummary(
      `### Roadmap Badges\n\n${found ? "Found" : "No"} catalog at ${codeSpan(catalog)}.\n`,
    );
  } catch (error) {
    runner.setFailed(error instanceof Error ? error.message : String(error));
  }
}
