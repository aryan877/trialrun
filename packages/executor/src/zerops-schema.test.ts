import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { compileZeropsSchema } from "./zerops-schema";

describe("compileZeropsSchema", () => {
  it("compiles the pinned official Zerops project-import schema", async () => {
    const path = new URL(
      "../../../.data/evidence/zerops-import-schema-2026-08-08.json",
      import.meta.url,
    );
    const schema: unknown = JSON.parse(await readFile(path, "utf8"));
    const validator = compileZeropsSchema(schema);

    expect(validator(null)).toBe(false);
    expect(validator.errors?.length).toBeGreaterThan(0);
  });

  it("rejects a value that does not contain an official Draft 2020-12 schema envelope", () => {
    expect(() => compileZeropsSchema({ type: "object" })).toThrow(
      "Expected an official Draft 2020-12 JSON Schema",
    );
  });
});
