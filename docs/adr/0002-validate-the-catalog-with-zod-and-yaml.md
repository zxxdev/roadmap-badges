# 0002. Validate the catalog with zod and report positions with yaml

- **Status:** accepted
- **Date:** 2026-11-25

## Context

Every number the action publishes starts from `progress.yml`. A typo there (a misspelt field, an
id that tests cannot link to) must not turn into a wrong percentage: the action has to refuse
the file and say exactly where the problem is, so it can be fixed from the error alone.

Editors should also help while the file is written, which means a JSON Schema. If the JSON
Schema and the action's own checks were written separately, they would drift apart.

## Options

1. **zod for the rules, `yaml` for parsing.** The schema is written once in TypeScript; its
   types are inferred from it and zod generates the JSON Schema. The
   [`yaml`](https://eemeli.org/yaml/) library keeps each node's position, so the path that zod
   reports (`areas.0.items.1.title`) can be turned into a line and column. Two runtime
   dependencies, both without dependencies of their own; the bundle grows from about 1.0 MB to
   1.5 MB.
2. **A hand-written JSON Schema checked with Ajv.** One source of truth, a standard format; but
   the TypeScript types would be written a second time, and Ajv's messages are harder to turn
   into plain sentences.
3. **Hand-written checks.** No dependencies, but every rule, message and the JSON Schema would
   be code to write and keep in step by hand.

## Decision

Option 1. The catalog schema lives in `src/catalog/schema.ts`; `schema/progress.schema.json` is
generated from it (draft 7, the version editors support best) and a test fails if the committed
file differs.

Rules of the format that matter for honest numbers:

- **Every item states its evidence** (`junit` or `manual`); there is no default, so a manual
  item is always visible as such.
- **Ids are unique**, item ids across the whole catalog, because a test links to an item by
  `@<id>` alone.
- **Dropped items keep their reason** (`dropped: <why>`): they leave the total but stay in the
  file and, later, in the report. Removing an item from the list is what the history will show.
- **Unknown fields are errors**, not ignored, so a misspelt `dropped` cannot silently count.
- **A missing or invalid catalog fails the step**; it never becomes an empty or 0% result.

## Consequences

- Each problem is reported with file, line, column and field, as an error annotation on that
  line in pull requests, and all problems are reported at once.
- The YAML is read as YAML 1.2: `yes` and `no` are text, not booleans, so `done: yes` is an
  error that says to use `true` or `false`. Repeated keys are errors, and alias expansion is
  capped to stop "billion laughs" files.
- Two more packages end up in `dist/index.js` and run in other people's workflows. Both are
  widely used, have no dependencies, and follow the same 7-day quarantine as everything else.
- The JSON Schema cannot express every rule (unique ids, trimmed text): the editor helps, the
  action decides.
- Adding a field or an evidence type is a schema change plus a regenerated JSON Schema, in the
  same pull request.
