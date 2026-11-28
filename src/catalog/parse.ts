/**
 * Reads progress.yml and either returns the catalog or lists every problem
 * with the line, column and field where it is.
 *
 * The YAML is parsed with the `yaml` library because it keeps the position of
 * each node in the file: zod says which field is wrong (a path such as
 * areas.0.items.1.title), and the YAML document says where that field is.
 */
import { isMap, isScalar, LineCounter, parseDocument, type Document } from "yaml";
import type { z } from "zod";
import { catalogSchema, EVIDENCE_TYPES, type Catalog } from "./schema.js";

/** One problem in the catalog. Line and column start at 1. */
export interface CatalogError {
  line: number;
  column: number;
  /** The field, such as "areas[0].items[1].title". Empty for the whole file. */
  field: string;
  message: string;
}

export type ParseResult = { ok: true; catalog: Catalog } | { ok: false; errors: CatalogError[] };

type Path = readonly (string | number)[];

/**
 * YAML aliases can repeat a node many times ("billion laughs"). The library
 * stops at this many when converting to plain data; a catalog needs none.
 */
const MAX_ALIAS_COUNT = 100;

/** Fields that belong to one kind of item, to explain why another kind rejects them. */
const FIELD_HINTS: Record<string, string> = {
  done: "only manual items have it",
  tests: "only junit items have it",
};

export function parseCatalog(text: string): ParseResult {
  const lines = new LineCounter();
  // A byte order mark would count as a character and shift columns on line 1.
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const doc = parseDocument(source, { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  const at = (offset: number) => {
    const { line, col } = lines.linePos(offset);
    return { line, column: col };
  };

  // With broken YAML the data may be cut short, so only syntax errors are worth showing.
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((error) => ({
        ...at(error.pos[0]),
        field: "",
        message: `invalid YAML: ${firstLine(error.message)}`,
      })),
    };
  }

  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [{ line: 1, column: 1, field: "", message }] };
  }

  const errors: CatalogError[] = [];
  const checked = catalogSchema.safeParse(data);
  if (!checked.success) {
    for (const issue of checked.error.issues) {
      errors.push(...describeIssue(issue, data, doc, at));
    }
  }
  errors.push(...duplicateIds(data, doc, at));

  if (errors.length > 0 || !checked.success) {
    return { ok: false, errors: sortByPosition(errors) };
  }
  return { ok: true, catalog: checked.data };
}

/** "progress.yml:7:9 areas[0].items[1].title: must not be empty" */
export function formatError(file: string, error: CatalogError): string {
  const field = error.field ? ` ${error.field}:` : "";
  return `${file}:${String(error.line)}:${String(error.column)}${field} ${error.message}`;
}

type At = (offset: number) => { line: number; column: number };

/** Turns one zod issue into errors at the right place, with a plain message. */
function describeIssue(
  issue: z.core.$ZodIssue,
  data: unknown,
  doc: Document,
  at: At,
): CatalogError[] {
  const path = issue.path.filter((key) => typeof key !== "symbol");

  if (issue.code === "unrecognized_keys") {
    // Point at each unknown key itself, not at the start of its mapping.
    return issue.keys.map((key) => {
      const hint = FIELD_HINTS[key];
      return {
        ...at(keyOffset(doc, path, key) ?? nodeOffset(doc, path)),
        field: fieldName([...path, key]),
        message: `unknown field${hint ? ` (${hint})` : ""}`,
      };
    });
  }

  if (issue.code === "invalid_union" && issue.errors.length === 0) {
    // The only union is the item, chosen by its "evidence" field. zod puts that
    // field at the end of the path; older versions pointed at the item itself.
    const evidencePath = path.at(-1) === "evidence" ? path : [...path, "evidence"];
    const value = valueAt(data, evidencePath);
    const options = EVIDENCE_TYPES.map((type) => `"${type}"`).join(" or ");
    return [
      {
        ...at(nodeOffset(doc, evidencePath)),
        field: fieldName(evidencePath),
        message:
          value === undefined
            ? `missing required field; must be ${options}`
            : `must be ${options}, not ${describeValue(value)}`,
      },
    ];
  }

  const value = valueAt(data, path);
  let message = issue.message;
  if (issue.code === "invalid_type") {
    message =
      value === undefined
        ? "missing required field"
        : `must be ${typeName(issue.expected)}, not ${describeValue(value)}`;
    // `color: #1a7f37` without quotes is a key with a comment after it, so YAML reads null.
    if (value === null && path.at(-1) === "color") {
      message = 'must be a colour in quotes, such as "#1a7f37": in YAML, # starts a comment';
    }
  }
  const root = path.length === 0;
  return [
    {
      ...at(nodeOffset(doc, path)),
      field: fieldName(path),
      message: root ? `the catalog must be a mapping with "project" and "areas"` : message,
    },
  ];
}

/**
 * Area ids must be unique, and item ids unique across the whole catalog,
 * because tests link to an item by its id alone. Checked on the raw data so
 * duplicates are reported together with every other problem.
 */
function duplicateIds(data: unknown, doc: Document, at: At): CatalogError[] {
  if (!isRecord(data) || !Array.isArray(data.areas)) return [];
  const errors: CatalogError[] = [];
  const areaIds = new Map<string, Path>();
  const itemIds = new Map<string, Path>();

  const check = (seen: Map<string, Path>, value: unknown, path: Path, what: string) => {
    if (typeof value !== "string") return;
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, path);
      return;
    }
    errors.push({
      ...at(nodeOffset(doc, path)),
      field: fieldName(path),
      message: `duplicate ${what} id "${value}", first used at line ${String(at(nodeOffset(doc, first)).line)}`,
    });
  };

  data.areas.forEach((area: unknown, a) => {
    if (!isRecord(area)) return;
    check(areaIds, area.id, ["areas", a, "id"], "area");
    if (!Array.isArray(area.items)) return;
    area.items.forEach((item: unknown, i) => {
      if (isRecord(item)) check(itemIds, item.id, ["areas", a, "items", i, "id"], "item");
    });
  });
  return errors;
}

/**
 * Offset of the node at the path. When the path does not exist (a missing
 * field), it is the offset of the closest parent that does.
 */
function nodeOffset(doc: Document, path: Path): number {
  for (let length = path.length; length >= 0; length--) {
    const node: unknown = doc.getIn(path.slice(0, length), true);
    if (hasRange(node)) return node.range[0];
  }
  return 0;
}

/** Offset of a key inside the mapping at the path. */
function keyOffset(doc: Document, path: Path, key: string): number | undefined {
  const map: unknown = doc.getIn(path, true);
  if (!isMap(map)) return undefined;
  const pair = map.items.find((p) => isScalar(p.key) && p.key.value === key);
  return pair && hasRange(pair.key) ? pair.key.range[0] : undefined;
}

function hasRange(node: unknown): node is { range: [number, number, number] } {
  return isRecord(node) && Array.isArray(node.range) && typeof node.range[0] === "number";
}

function valueAt(data: unknown, path: Path): unknown {
  let current = data;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === "number") current = current[key];
    else if (isRecord(current) && typeof key === "string") current = current[key];
    else return undefined;
  }
  return current;
}

/** ["areas", 0, "items", 1, "title"] → "areas[0].items[1].title" */
function fieldName(path: Path): string {
  return path
    .map((key, index) =>
      typeof key === "number" ? `[${String(key)}]` : index === 0 ? key : `.${key}`,
    )
    .join("");
}

function typeName(expected: string): string {
  const names: Record<string, string> = {
    string: "text",
    number: "a whole number",
    int: "a whole number",
    boolean: "true or false",
    array: "a list",
    object: "a mapping",
  };
  return names[expected] ?? expected;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${value.length > 40 ? value.slice(0, 40) + "…" : value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "a list";
  if (value === null || value === undefined) return "empty";
  return "a mapping";
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortByPosition(errors: CatalogError[]): CatalogError[] {
  return errors.toSorted((a, b) => a.line - b.line || a.column - b.column);
}
