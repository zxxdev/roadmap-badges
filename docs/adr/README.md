# Architecture decision records

Each record explains one decision: the problem, the options considered, what was chosen and what it
costs. New records copy [template.md](template.md) and take the next number.

| #                                                        | Decision                                                         | Status   |
| -------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| [0001](0001-bundle-the-action-with-rollup.md)            | Write the action in TypeScript and commit a Rollup bundle        | accepted |
| [0002](0002-validate-the-catalog-with-zod-and-yaml.md)   | Validate the catalog with zod and report positions with yaml     | accepted |
| [0003](0003-an-item-is-done-only-when-its-tests-pass.md) | Count an item as done only when its linked tests exist and pass  | accepted |
| [0004](0004-read-junit-reports-with-sax.md)              | Read JUnit reports with sax in strict mode                       | accepted |
| [0005](0005-draw-badges-by-hand-with-font-metrics.md)    | Draw the badges by hand, sized with widths read from a font file | accepted |
