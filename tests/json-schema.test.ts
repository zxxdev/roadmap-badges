import { describe, expect, it } from "vitest";
import { catalogJsonSchema, JSON_SCHEMA_URL } from "../src/catalog/schema.js";

describe("catalogJsonSchema @catalog.json-schema", () => {
  // schema/progress.schema.json is generated: run `pnpm test -u` after changing
  // src/catalog/schema.ts. In CI the file is only compared, never written.
  it("matches the committed schema/progress.schema.json", async () => {
    const text = JSON.stringify(catalogJsonSchema(), null, 2) + "\n";
    await expect(text).toMatchFileSnapshot("../schema/progress.schema.json");
  });

  it("is a draft 7 schema that editors can find by its URL", () => {
    const schema = catalogJsonSchema();
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.$id).toBe(JSON_SCHEMA_URL);
    expect(schema.required).toEqual(["project", "areas"]);
    expect(schema.additionalProperties).toBe(false);
  });
});
