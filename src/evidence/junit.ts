/**
 * Reads JUnit XML reports. "JUnit XML" is not one standard: Vitest, Pester,
 * pytest, Playwright and Maven Surefire each write their own variant. This
 * reader turns any of them into a flat list of test cases, so the rest of the
 * action never sees the differences:
 *
 * - The root can be <testsuites> or a single <testsuite>, and suites can be
 *   nested at any depth. The reader walks the whole tree.
 * - The summary attributes (tests="12" failures="1") are ignored, because
 *   some tools write totals that do not match the cases. The cases are counted.
 * - A case's result comes from its child elements: <failure>, <error> and
 *   <skipped>. Surefire's <flakyFailure> and <flakyError> mean the test passed
 *   on a retry: it counts as passed and is marked flaky.
 *
 * The XML is parsed with sax in strict mode, which never expands entities
 * declared in a DOCTYPE and never loads external ones. A report is input that
 * the action does not fully control, and both are classic attacks: a few
 * nested entities that expand to gigabytes ("billion laughs"), and an entity
 * that reads a file from the machine (XXE).
 */
import sax, { type QualifiedTag, type Tag } from "sax";

export type TestStatus = "passed" | "failed" | "error" | "skipped";

/** One <testcase> in a report. */
export interface TestCase {
  /** The report it was read from, as given to the reader. */
  file: string;
  /** The name of the innermost <testsuite> around it; empty if it has none. */
  suite: string;
  classname: string;
  name: string;
  status: TestStatus;
  /** It passed only after failing at least once. */
  flaky: boolean;
}

/** A report that cannot be read. Line and column start at 1 when known. */
export class ReportError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    const at = line === undefined ? "" : `:${String(line)}:${String(column ?? 1)}`;
    super(`${file}${at}: ${reason}`);
    this.name = "ReportError";
  }
}

/** What a child element of a <testcase> says about its result. */
const RESULT_ELEMENTS: Record<string, TestStatus> = {
  failure: "failed",
  error: "error",
  skipped: "skipped",
};
const FLAKY_ELEMENTS = new Set(["flakyFailure", "flakyError"]);

/** Within one case, the most serious result wins. */
const SEVERITY: Record<TestStatus, number> = { passed: 0, skipped: 1, failed: 2, error: 3 };

const ROOTS = new Set(["testsuites", "testsuite"]);

export function parseJUnitReport(text: string, file: string): TestCase[] {
  // A byte order mark is not XML: sax would reject it as text before the root.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (source.trim() === "") {
    throw new ReportError(file, "the file is empty");
  }

  const parser = sax.parser(true, { position: true });
  const where = () => ({ line: parser.line + 1, column: parser.column });
  const fail = (reason: string): never => {
    const { line, column } = where();
    throw new ReportError(file, reason, line, column);
  };

  const cases: TestCase[] = [];
  const suites: string[] = [];
  const open: string[] = [];
  let current: TestCase | undefined;
  // Set by the callbacks below. Without "as boolean", TypeScript assumes it
  // is still false after parsing, because it cannot see the callbacks run.
  let sawRoot = false as boolean;

  parser.onerror = (error) => {
    fail(describeXmlError(error.message));
  };

  parser.onopentag = (tag) => {
    const parent = open.at(-1);
    open.push(tag.name);

    if (!sawRoot) {
      sawRoot = true;
      if (!ROOTS.has(tag.name)) fail(notJUnit(tag.name));
    }

    if (tag.name === "testsuite") {
      suites.push(attribute(tag, "name"));
    } else if (tag.name === "testcase") {
      if (current !== undefined) fail("a <testcase> inside another <testcase>");
      current = {
        file,
        suite: suites.at(-1) ?? "",
        classname: attribute(tag, "classname"),
        name: attribute(tag, "name"),
        status: "passed",
        flaky: false,
      };
    } else if (current !== undefined && parent === "testcase") {
      const status = RESULT_ELEMENTS[tag.name];
      if (status !== undefined && SEVERITY[status] > SEVERITY[current.status]) {
        current.status = status;
      }
      if (FLAKY_ELEMENTS.has(tag.name)) current.flaky = true;
    }
  };

  parser.onclosetag = (name) => {
    open.pop();
    if (name === "testsuite") {
      suites.pop();
    } else if (name === "testcase" && current !== undefined) {
      cases.push(current);
      current = undefined;
    }
  };

  parser.write(source).close();
  if (!sawRoot) throw new ReportError(file, "there is no XML element in the file");
  return cases;
}

/** An attribute's value, or "" when the element does not have it. */
function attribute(tag: Tag | QualifiedTag, name: string): string {
  const value = tag.attributes[name];
  return typeof value === "string" ? value : (value?.value ?? "");
}

/** sax's message without its position lines, with a hint for the safety refusal. */
function describeXmlError(message: string): string {
  const reason = message.split("\n")[0] ?? message;
  if (reason === "Invalid character entity") {
    return (
      "invalid XML: it uses an entity that XML does not define. Entities declared in a " +
      "DOCTYPE are never expanded, for safety"
    );
  }
  return `invalid XML: ${reason}`;
}

function notJUnit(root: string): string {
  const reason = `not a JUnit report: the root element is <${root}>, not <testsuites> or <testsuite>`;
  // Pester writes NUnit XML (<test-results>) unless it is told otherwise.
  return root === "test-results" || root === "test-run"
    ? `${reason}. It looks like NUnit XML; in Pester, set TestResult.OutputFormat to JUnitXml`
    : reason;
}
