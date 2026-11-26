# 0003. Count an item as done only when its linked tests exist and pass

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The percentage is the whole point of the action, and every repository that uses it publishes
that number. The rule that turns test results into "done" decides whether the number can be
trusted. It has to answer awkward cases: an item with no test, a skipped test, a test that
passes on Linux and is skipped on Windows, the same test in two reports, a test retried until it
passed, an area with nothing in it.

The rule must not reward the easy ways to make a number go up: deleting a failing test, skipping
it, or misspelling a tag.

## Options

1. **Done unless a linked test fails.** Simple, but an item with no test, or with all its tests
   skipped, would count as done: deleting or skipping a test would raise the percentage.
2. **Three states: done, not done and unknown.** Items without evidence would leave the total.
   Honest about what is unknown, but the same loophole: removing a test moves an item out of the
   denominator and the percentage goes up.
3. **Done only when at least one linked test exists and every linked test passes.** Anything
   else is "not done", with the reason.

## Decision

Option 3. In detail:

- A `junit` item needs at least one linked test, and all of them must pass. Otherwise it is not
  done, with the most serious reason: a test failed or ended in an error; a test named in its
  `tests` selectors is in no report; a test was skipped; no test is linked.
- A test links by the tag `@<item id>` in its name, compared as a whole id (a test tagged
  `@api.get-all` does not link to `api.get`), or by a selector in the catalog. Both can be used
  together.
- When the same test (same `classname` and `name`) appears more than once, a failure in any run
  counts. Otherwise a pass counts over a skip, so a Windows-only test that is skipped on Linux
  and passes on Windows proves its item. The earlier design said "the worst result counts",
  which would have made that test useless in a two-system build.
- A test that passed after a retry (Surefire's `flakyFailure`) counts as passed and is reported.
- Manual items use their `done` flag. Dropped items leave the total but stay in the report.
- Percentages are rounded down, so 100 % means everything is done (199 of 200 is 99 %). An area
  with nothing to count has no percentage, rather than 0 % or 100 %.
- A report pattern that matches no file fails the step instead of giving 0 %. A tag that matches
  no item is a warning, or an error with `strict: true`, because it is usually a misspelt id.

## Consequences

- Deleting, skipping or mistyping a test can only lower the percentage, never raise it.
- The number is harsh while tests are being written: an item stays at "not done" until its first
  test exists and passes. That is the intended reading.
- A pass in one report outranks a skip in another. Someone could make an item done with a test
  that passes trivially on one system; that is the same limit as any test that passes without
  checking anything, which no rule based on test results can see.
- Test names must not contain `@` followed by an id unless they mean it as a tag. This
  repository's own tests about tags describe their examples instead of quoting them.
