import { describe, expect, it } from "vitest";
import { parseJUnitReport, ReportError, type TestCase } from "../src/evidence/junit.js";

const FILE = "reports/junit.xml";

/** The fields that matter in most tests, in report order. */
function results(xml: string): Pick<TestCase, "name" | "status">[] {
  return parseJUnitReport(xml, FILE).map(({ name, status }) => ({ name, status }));
}

/** The ReportError that reading the text throws. */
function readError(xml: string): ReportError {
  try {
    parseJUnitReport(xml, FILE);
  } catch (error) {
    if (error instanceof ReportError) return error;
    throw error;
  }
  throw new Error("expected the report to be rejected");
}

describe("parseJUnitReport @evidence.junit", () => {
  it("reads passed, failed, errored and skipped cases from their child elements", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <testsuites>
        <testsuite name="api">
          <testcase classname="api.users" name="lists users" time="0.01"/>
          <testcase classname="api.users" name="gets a user"><failure message="expected 200">trace</failure></testcase>
          <testcase classname="api.users" name="deletes a user"><error type="TypeError"/></testcase>
          <testcase classname="api.users" name="exports users"><skipped/></testcase>
          <testcase classname="api.users" name="prints output"><system-out>hello</system-out></testcase>
        </testsuite>
      </testsuites>`;

    expect(parseJUnitReport(xml, FILE)).toEqual([
      {
        file: FILE,
        suite: "api",
        classname: "api.users",
        name: "lists users",
        status: "passed",
        flaky: false,
      },
      {
        file: FILE,
        suite: "api",
        classname: "api.users",
        name: "gets a user",
        status: "failed",
        flaky: false,
      },
      {
        file: FILE,
        suite: "api",
        classname: "api.users",
        name: "deletes a user",
        status: "error",
        flaky: false,
      },
      {
        file: FILE,
        suite: "api",
        classname: "api.users",
        name: "exports users",
        status: "skipped",
        flaky: false,
      },
      {
        file: FILE,
        suite: "api",
        classname: "api.users",
        name: "prints output",
        status: "passed",
        flaky: false,
      },
    ]);
  });

  it("reads a report whose root is a single <testsuite>", () => {
    expect(results(`<testsuite name="only"><testcase name="a"/></testsuite>`)).toEqual([
      { name: "a", status: "passed" },
    ]);
  });

  it("reads every case in suites nested three levels deep, with the innermost suite's name", () => {
    const xml = `<testsuites>
      <testsuite name="outer">
        <testcase name="one"/>
        <testsuite name="middle">
          <testsuite name="inner"><testcase name="two"/></testsuite>
          <testcase name="three"/>
        </testsuite>
      </testsuite>
    </testsuites>`;

    expect(parseJUnitReport(xml, FILE).map(({ name, suite }) => `${suite}/${name}`)).toEqual([
      "outer/one",
      "inner/two",
      "middle/three",
    ]);
  });

  it("counts the real cases and ignores summary attributes that do not match them", () => {
    const xml = `<testsuites tests="12" failures="0" skipped="5">
      <testsuite name="s" tests="1" failures="0">
        <testcase name="a"/><testcase name="b"><failure/></testcase>
      </testsuite>
    </testsuites>`;

    expect(results(xml)).toEqual([
      { name: "a", status: "passed" },
      { name: "b", status: "failed" },
    ]);
  });

  it("counts a case that passed on a retry as passed and marks it flaky (Surefire)", () => {
    const xml = `<testsuite name="s">
      <testcase name="retried"><flakyFailure message="timeout"/></testcase>
      <testcase name="retried after an error"><flakyError/></testcase>
    </testsuite>`;

    expect(
      parseJUnitReport(xml, FILE).map(({ name, status, flaky }) => ({ name, status, flaky })),
    ).toEqual([
      { name: "retried", status: "passed", flaky: true },
      { name: "retried after an error", status: "passed", flaky: true },
    ]);
  });

  it("keeps the most serious result when a case has several", () => {
    const xml = `<testsuite name="s">
      <testcase name="a"><skipped/><failure/></testcase>
      <testcase name="b"><error/><failure/></testcase>
    </testsuite>`;

    expect(results(xml)).toEqual([
      { name: "a", status: "failed" },
      { name: "b", status: "error" },
    ]);
  });

  it("only takes results from direct children of the case", () => {
    const xml = `<testsuite name="s"><testcase name="a"><properties><skipped/></properties></testcase></testsuite>`;

    expect(results(xml)).toEqual([{ name: "a", status: "passed" }]);
  });

  it("decodes XML's own entities and character references in names", () => {
    const xml = `<testsuite name="s"><testcase classname="Ünïcode" name="a &amp; b &lt;c&gt; &quot;d&quot; &#233; &#x1F600;"/></testsuite>`;

    const [only] = parseJUnitReport(xml, FILE);
    expect(only?.name).toBe('a & b <c> "d" é 😀');
    expect(only?.classname).toBe("Ünïcode");
  });

  it("keeps names with line breaks and control characters as they are", () => {
    const xml = `<testsuite name="s"><testcase name="line one&#10;line two"/><testcase name="bell \u0007 here"/></testsuite>`;

    expect(results(xml).map(({ name }) => name)).toEqual([
      "line one\nline two",
      "bell \u0007 here",
    ]);
  });

  it("uses an empty classname or suite when the report leaves them out", () => {
    const [only] = parseJUnitReport(
      `<testsuites><testsuite><testcase name="a"/></testsuite></testsuites>`,
      FILE,
    );
    expect(only?.classname).toBe("");
    expect(only?.suite).toBe("");
  });

  it("accepts a byte order mark before the XML declaration", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(
      results(`${bom}<?xml version="1.0"?><testsuite name="s"><testcase name="a"/></testsuite>`),
    ).toHaveLength(1);
  });

  it("returns no cases for a suite without any", () => {
    expect(results(`<testsuites><testsuite name="empty" tests="0"/></testsuites>`)).toEqual([]);
  });
});

describe("parseJUnitReport rejects what it cannot read @evidence.junit", () => {
  it("rejects an empty file, naming it", () => {
    const error = readError("  \n ");
    expect(error.message).toBe("reports/junit.xml: the file is empty");
    expect(error.line).toBeUndefined();
  });

  it("rejects broken XML with the file, line and column", () => {
    const error = readError(
      `<testsuite name="s">\n  <testcase name="a">\n    <failure>oops</testcase>\n</testsuite>`,
    );

    expect(error.message).toMatch(/^reports\/junit\.xml:3:\d+: invalid XML: Unexpected close tag$/);
    expect(error.file).toBe(FILE);
    expect(error.line).toBe(3);
  });

  it("rejects a report that is cut short", () => {
    expect(readError(`<testsuites><testsuite name="s"><testcase name="a"/>`).message).toContain(
      "invalid XML: Unclosed root tag",
    );
  });

  it("rejects a file with no element, such as only an XML declaration", () => {
    expect(readError(`<?xml version="1.0"?>\n<!-- nothing -->`).reason).toBe(
      "there is no XML element in the file",
    );
  });

  it("rejects a file that is not a JUnit report", () => {
    expect(readError(`<coverage line-rate="0.9"/>`).reason).toBe(
      "not a JUnit report: the root element is <coverage>, not <testsuites> or <testsuite>",
    );
  });

  it("says how to get JUnit from Pester when it gets Pester's default NUnit report", () => {
    expect(readError(`<test-results name="Pester" total="1"/>`).reason).toContain(
      "set TestResult.OutputFormat to JUnitXml",
    );
  });

  it("rejects a case inside another case", () => {
    expect(
      readError(`<testsuite><testcase name="a"><testcase name="b"/></testcase></testsuite>`).reason,
    ).toBe("a <testcase> inside another <testcase>");
  });

  it("does not expand nested entities declared in a DOCTYPE (billion laughs)", () => {
    const levels = Array.from({ length: 9 }, (_, index) => {
      const level = index + 1;
      return `<!ENTITY lol${String(level)} "${`&lol${String(level - 1)};`.repeat(10)}">`;
    });
    const xml = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol0 "lol">
  ${levels.join("\n  ")}
]>
<testsuite name="s"><testcase name="&lol9;"/></testsuite>`;

    const started = performance.now();
    const error = readError(xml);
    expect(error.reason).toContain("Entities declared in a DOCTYPE are never expanded");
    expect(error.line).toBe(14);
    // Expanded, &lol9; would be a billion "lol"s: the refusal must be instant.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("does not load external entities (XXE)", () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE r [<!ENTITY secret SYSTEM "file:///etc/hostname">]>
<testsuite name="s"><testcase name="before &secret; after"/></testsuite>`;

    const error = readError(xml);
    expect(error.reason).toContain("never expanded");
    expect(error.message).not.toMatch(/before|after/);
  });
});
