# 0001. Write the action in TypeScript and commit a Rollup bundle

- **Status:** accepted
- **Date:** 2026-11-22

## Context

A JavaScript action runs straight from the repository: GitHub checks out the tag the workflow
asks for and runs the file named in `action.yml`, without installing dependencies. Since
September 2026 runners only run JavaScript actions on Node 24 (`runs.using: node24`).

So the code and its dependencies have to be in one file that is committed, and that file must
not drift from the source.

## Options

1. **Rollup**, as the official [actions/typescript-action](https://github.com/actions/typescript-action)
   template does. Plain JavaScript with a native optional binary, no install scripts; one more
   config file and four packages.
2. **esbuild.** Fast and a single package, but its binary is set up by an install script, which
   this repository blocks by default (`strictDepBuilds`).
3. **@vercel/ncc.** What the template used before; it has since moved to Rollup.

TypeScript: **6.0**, not 7.0. TypeScript 7 is the native rewrite, and typescript-eslint
(type-aware lint rules) supports TypeScript below 6.1 only, like the official template (5.9).

## Decision

TypeScript 6.0 compiled and bundled by Rollup into `dist/index.js` (ES module), committed. CI
rebuilds the bundle and fails if it differs from what is committed, then runs the action from
the checkout.

## Consequences

- Anyone can use the action with one `uses:` line; nothing is installed at run time.
- The bundle is ~1 MB of generated code in the repository. `.gitattributes` hides it from diffs
  and language stats, and CodeQL analyses `src/` instead.
- A pull request that changes `src/` must also commit the new `dist/`; CI catches it if not.
- The same lockfile gives the same bundle byte for byte (checked: two builds, same SHA-256),
  which is what makes the CI comparison work.
- Revisit TypeScript 7 when typescript-eslint supports it; Dependabot ignores TypeScript 6.1+
  until then.
