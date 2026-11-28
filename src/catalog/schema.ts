/**
 * The shape of progress.yml, written once with zod. The same definition checks
 * catalogs at run time and produces the JSON Schema that editors use to
 * autocomplete the file (catalogJsonSchema below).
 */
import { z } from "zod";

/** Where the published JSON Schema lives, so editors can find it by URL. */
export const JSON_SCHEMA_URL =
  "https://raw.githubusercontent.com/zxxdev/roadmap-badges/main/schema/progress.schema.json";

/**
 * Ids are lowercase words joined by single dots or hyphens, such as
 * "api.get-user". Tests link to an item by putting "@<id>" in their name, so
 * an id must be easy to type and must not contain spaces or "@".
 */
export const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ID_RULE =
  'must be lowercase letters and digits, joined by single "." or "-" (for example "api.get-user")';

const id = (what: string) =>
  z
    .string()
    .max(64, { error: "must be at most 64 characters" })
    .regex(ID_PATTERN, { error: ID_RULE })
    .meta({ description: `${what} Lowercase letters and digits joined by "." or "-".` });

const text = (description: string) =>
  z.string().trim().min(1, { error: "must not be empty" }).meta({ description });

const dropped = text(
  "Why the item was dropped. A dropped item leaves the total but stays in the report with this reason.",
);

const testSelector = z
  .strictObject({
    name: text("The test's name, exactly as it appears in the JUnit report."),
    classname: text(
      "The test's classname in the JUnit report, when the name alone is ambiguous.",
    ).optional(),
  })
  .meta({ description: "One test that proves the item." });

const junitItem = z
  .strictObject({
    id: id("Unique id of the item; tests link to it with @<id> in their name."),
    title: text("What the item is, in a few words."),
    evidence: z
      .literal("junit")
      .meta({ description: "Done when all its tests are in the JUnit reports and pass." }),
    tests: z
      .array(testSelector)
      .min(1, { error: "needs at least one test, or leave it out to link by @<id> tag" })
      .optional()
      .meta({
        description:
          "Tests that prove the item, for tests that cannot carry the @<id> tag in their name.",
      }),
    dropped: dropped.optional(),
  })
  .meta({ title: "Item proved by tests" });

const manualItem = z
  .strictObject({
    id: id("Unique id of the item."),
    title: text("What the item is, in a few words."),
    evidence: z.literal("manual").meta({
      description: "Decided by the done flag. Use it only for what no test can check.",
    }),
    done: z.boolean().meta({ description: "Whether the item is done." }),
    dropped: dropped.optional(),
  })
  .meta({ title: "Item decided by hand" });

/** The kinds of evidence an item can have, in the order the docs list them. */
export const EVIDENCE_TYPES = ["junit", "manual"] as const;

const item = z.discriminatedUnion("evidence", [junitItem, manualItem]);

const area = z
  .strictObject({
    id: id("Unique id of the area; it names the area's badge file."),
    title: text("The area's name, shown on its badge and in the report."),
    items: z.array(item).meta({ description: "What the area sets out to do." }),
  })
  .meta({ description: "A group of items with its own badge." });

/** "#rgb" or "#rrggbb". Nothing else, because the colour goes into the SVG as it is. */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const threshold = z
  .strictObject({
    from: z
      .int()
      .min(0, { error: "must be between 0 and 100" })
      .max(100, { error: "must be between 0 and 100" })
      .meta({ description: "The lowest percentage, from 0 to 100, that gets this colour." }),
    color: z
      .string()
      .regex(HEX_COLOR, { error: 'must be a colour as "#rgb" or "#rrggbb", such as "#1a7f37"' })
      .meta({
        description:
          'Background colour as "#rgb" or "#rrggbb", in quotes (# starts a YAML comment).',
      }),
  })
  .meta({ description: "A colour for the percentages from this one up to the next threshold." });

const badges = z
  .strictObject({
    thresholds: z
      .array(threshold)
      .min(1, { error: "needs at least one threshold" })
      .superRefine((list, ctx) => {
        list.forEach((step, index) => {
          const previous = list[index - 1];
          if (previous === undefined && step.from !== 0) {
            ctx.addIssue({
              code: "custom",
              path: [index, "from"],
              message: "must be 0: the first threshold colours every percentage from 0",
            });
          } else if (previous !== undefined && step.from <= previous.from) {
            ctx.addIssue({
              code: "custom",
              path: [index, "from"],
              message: `must be greater than the previous threshold (${String(previous.from)})`,
            });
          }
        });
      })
      .optional()
      .meta({
        description:
          "Badge colours by percentage, lowest first; the first starts at 0. Without it, red below 50, orange below 80, yellow below 100 and green at 100.",
      }),
  })
  .meta({ description: "How the badges look." });

export const catalogSchema = z
  .strictObject({
    project: text("The project's name, shown in the report."),
    badges: badges.optional(),
    areas: z
      .array(area)
      .min(1, { error: "needs at least one area" })
      .meta({ description: "The areas of the project, each with its own badge." }),
  })
  .meta({
    title: "roadmap-badges catalog",
    description:
      "What a project sets out to do (progress.yml). roadmap-badges computes the progress from it and from the test results.",
  });

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogArea = Catalog["areas"][number];
export type CatalogItem = CatalogArea["items"][number];
export type Threshold = NonNullable<NonNullable<Catalog["badges"]>["thresholds"]>[number];

/**
 * The JSON Schema for progress.yml, generated from catalogSchema. Draft 7 is
 * the version that editors (VS Code's YAML extension, JetBrains) support best.
 * A test checks that schema/progress.schema.json matches this output.
 */
export function catalogJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(catalogSchema, { target: "draft-7" });
  const { $schema, ...rest } = generated;
  return { $schema, $id: JSON_SCHEMA_URL, ...rest };
}
