import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { z } from "zod";

const jsonSchemaEnvelope = z
  .record(z.string(), z.unknown())
  .refine((schema) => schema.$schema === "https://json-schema.org/draft/2020-12/schema", {
    message: "Expected an official Draft 2020-12 JSON Schema.",
  });

function describeErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export function compileZeropsSchema(schemaInput: unknown): ValidateFunction<unknown> {
  const schema = jsonSchemaEnvelope.parse(schemaInput);
  // The live Zerops schemas are valid Draft 2020-12, but currently contain
  // conditional `properties` blocks without an adjacent `type: object`.
  // Ajv's strictTypes lint rejects those official schemas before validation.
  // Keep schema validation enabled and all data-mutating options disabled,
  // while treating the provider's published schema as the source of truth.
  const ajv = new Ajv2020({
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    strict: false,
    useDefaults: false,
    validateSchema: true,
  });
  return ajv.compile(schema);
}

export function assertMatchesZeropsSchema(
  validator: ValidateFunction<unknown>,
  value: unknown,
  label: string,
): void {
  if (validator(value)) return;
  throw new Error(`${label} failed the current official Zerops schema: ${describeErrors(validator.errors)}.`);
}
