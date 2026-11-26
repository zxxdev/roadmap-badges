// Example suite for the JUnit reader's tests: generate.sh runs it with Vitest's
// JUnit reporter. Some tests fail or are skipped on purpose. The file name
// does not end in .test.ts, so the repository's own test run leaves it out.
import { describe, expect, it } from "vitest";

describe("users", () => {
  it("gets one user @vitest.get", () => {
    expect(1 + 1).toBe(2);
  });

  it("gets every user @vitest.get-all", () => {
    expect([1, 2]).toHaveLength(2);
  });

  it("lists users @vitest.list", () => {
    expect("page 1").toBe("page 1");
  });

  it("lists users in pages @vitest.list", () => {
    expect("page 2").toBe("page 1");
  });

  it.skip("exports users @vitest.export", () => {
    expect(true).toBe(true);
  });

  it("has a typo in its tag @vitest.gte", () => {
    expect(true).toBe(true);
  });
});
