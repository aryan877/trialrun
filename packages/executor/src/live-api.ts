import { redactText, redactTruncatedText } from "@trialrun/domain";
import { z } from "zod";

const maximumRequestBodyBytes = 64 * 1_024;
const forbiddenHeaderNames = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authenticate",
  "proxy-authorization",
  "transfer-encoding",
]);
const forbiddenJsonPathSegments = new Set(["__proto__", "constructor", "prototype"]);

export const liveApiMethodSchema = z.enum(["DELETE", "GET", "PATCH", "POST", "PUT"]);

export const liveApiPathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (path) =>
      /^\/(?!\/)/u.test(path) &&
      !path.includes("\\") &&
      !path.includes("#") &&
      ![...path].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      }),
    "Expected one relative same-origin request path.",
  )
  .refine((path) => {
    const target = new URL(path, "http://trialrun.invalid");
    return target.origin === "http://trialrun.invalid";
  }, "Request path must not contain an origin.");

export const liveApiRequestValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string().max(2_000) }),
  z.strictObject({
    kind: z.literal("secret"),
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/u),
  }),
]);

const liveApiHeaderSchema = z.strictObject({
  name: z
    .string()
    .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u)
    .max(120),
  value: liveApiRequestValueSchema,
});

const liveApiHeadersSchema = z
  .array(liveApiHeaderSchema)
  .max(20)
  .superRefine((headers, context) => {
    const names = new Set<string>();
    for (const [index, header] of headers.entries()) {
      const name = header.name.toLowerCase();
      if (forbiddenHeaderNames.has(name)) {
        context.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "This request header is controlled by TrialRun.",
        });
      }
      if (names.has(name)) {
        context.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "Request header names must be unique ignoring case.",
        });
      }
      names.add(name);
    }
  });

const liveApiJsonFieldsSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(120)
      .refine((key) => !forbiddenJsonPathSegments.has(key), "Unsafe JSON field name."),
    liveApiRequestValueSchema,
  )
  .refine((fields) => Object.keys(fields).length <= 40, "JSON field count exceeds the limit.");

export const liveApiRequestBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("json"), value: z.json() }),
  z.strictObject({ kind: z.literal("json_fields"), fields: liveApiJsonFieldsSchema }),
  z.strictObject({ kind: z.literal("text"), value: liveApiRequestValueSchema }),
]);

export const liveApiRequestSchema = z
  .strictObject({
    method: liveApiMethodSchema,
    path: liveApiPathSchema,
    headers: liveApiHeadersSchema.optional(),
    body: liveApiRequestBodySchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.method === "GET" && request.body !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "GET requests cannot include a request body.",
      });
    }
  });

const jsonScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const jsonPathSegmentSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((segment) => !forbiddenJsonPathSegments.has(segment), "Unsafe JSON path segment.");

export const liveApiAssertionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("status"), equals: z.number().int().min(100).max(599) }),
  z.strictObject({
    kind: z.literal("body_includes"),
    includes: z.string().min(1).max(2_000),
  }),
  z.strictObject({
    kind: z.literal("json_path_equals"),
    path: z.array(jsonPathSegmentSchema).min(1).max(8),
    equals: jsonScalarSchema,
  }),
]);

export type LiveApiRequest = z.infer<typeof liveApiRequestSchema>;
export type LiveApiAssertion = z.infer<typeof liveApiAssertionSchema>;

export type LiveApiContractErrorCode = "INVALID_INPUT" | "SECRET_NOT_APPROVED";

export class LiveApiContractError extends Error {
  readonly code: LiveApiContractErrorCode;

  constructor(code: LiveApiContractErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveApiContractError";
    this.code = code;
  }
}

export interface ResolvedLiveApiRequest {
  readonly method: z.infer<typeof liveApiMethodSchema>;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly contentType?: string;
  readonly secretNames: readonly string[];
  readonly evidenceSummary: {
    readonly method: z.infer<typeof liveApiMethodSchema>;
    readonly path: string;
    readonly headerNames: readonly string[];
    readonly body?: {
      readonly kind: z.infer<typeof liveApiRequestBodySchema>["kind"];
      readonly byteSize: number;
      readonly secretNames: readonly string[];
    };
  };
}

export interface LiveApiAssertionResponse {
  readonly status: number;
  readonly bodyText: string;
  readonly bodyTruncated: boolean;
  readonly contentType?: string;
}

export interface LiveApiAssertionEvaluation {
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
  readonly fingerprintInput: Readonly<Record<string, unknown>>;
}

function invalidInput(message: string, cause?: unknown): LiveApiContractError {
  return new LiveApiContractError(
    "INVALID_INPUT",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function resolveValue(
  value: z.infer<typeof liveApiRequestValueSchema>,
  secrets: Readonly<Record<string, string>>,
  usedSecrets: Set<string>,
): string {
  if (value.kind === "literal") return value.value;
  const resolved = secrets[value.name];
  if (resolved === undefined) {
    throw new LiveApiContractError(
      "SECRET_NOT_APPROVED",
      `Named test secret ${value.name} is not approved for this review.`,
    );
  }
  usedSecrets.add(value.name);
  return resolved;
}

export function resolveLiveApiRequest(
  request: LiveApiRequest,
  secrets: Readonly<Record<string, string>>,
): ResolvedLiveApiRequest {
  const parsed = liveApiRequestSchema.safeParse(request);
  if (!parsed.success) throw invalidInput("Live API request is invalid.", parsed.error);

  const usedSecrets = new Set<string>();
  const headers: Record<string, string> = {};
  for (const header of parsed.data.headers ?? []) {
    headers[header.name] = resolveValue(header.value, secrets, usedSecrets);
  }

  let body: string | undefined;
  let contentType: string | undefined;
  const requestBody = parsed.data.body;
  if (requestBody?.kind === "json") {
    body = JSON.stringify(requestBody.value);
    contentType = "application/json";
  } else if (requestBody?.kind === "json_fields") {
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(requestBody.fields)) {
      fields[name] = resolveValue(value, secrets, usedSecrets);
    }
    body = JSON.stringify(fields);
    contentType = "application/json";
  } else if (requestBody?.kind === "text") {
    body = resolveValue(requestBody.value, secrets, usedSecrets);
    contentType = "text/plain; charset=utf-8";
  }

  const bodyByteSize = body === undefined ? 0 : Buffer.byteLength(body, "utf8");
  if (bodyByteSize > maximumRequestBodyBytes) {
    throw invalidInput("Live API request body exceeds the 64 KiB limit.");
  }
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === "content-type");
  if (body !== undefined && contentType !== undefined && !hasContentType) {
    headers["Content-Type"] = contentType;
  }

  return {
    method: parsed.data.method,
    path: parsed.data.path,
    headers,
    ...(body === undefined ? {} : { body }),
    ...(contentType === undefined ? {} : { contentType }),
    secretNames: [...usedSecrets].sort(),
    evidenceSummary: {
      method: parsed.data.method,
      path: parsed.data.path,
      headerNames: Object.keys(headers)
        .map((name) => name.toLowerCase())
        .sort(),
      ...(requestBody === undefined
        ? {}
        : {
            body: {
              kind: requestBody.kind,
              byteSize: bodyByteSize,
              secretNames: [...usedSecrets].sort(),
            },
          }),
    },
  };
}

function boundedActual(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= 2_000) return value;
  return `${bytes
    .subarray(0, 1_980)
    .toString("utf8")
    .replace(/\uFFFD$/u, "")}\n[truncated]`;
}

function jsonScalarText(value: z.infer<typeof jsonScalarSchema>): string {
  return JSON.stringify(value);
}

export function evaluateLiveApiAssertion(
  response: LiveApiAssertionResponse,
  assertion: LiveApiAssertion,
): LiveApiAssertionEvaluation {
  const parsed = liveApiAssertionSchema.safeParse(assertion);
  if (!parsed.success) throw invalidInput("Live API assertion is invalid.", parsed.error);
  if (parsed.data.kind === "status") {
    return {
      passed: response.status === parsed.data.equals,
      expected: `HTTP ${parsed.data.equals}`,
      actual: `HTTP ${response.status}`,
      fingerprintInput: { kind: parsed.data.kind, equals: parsed.data.equals },
    };
  }
  if (response.bodyTruncated) {
    throw invalidInput("A truncated API response cannot support a body assertion.");
  }
  if (parsed.data.kind === "body_includes") {
    return {
      passed: response.bodyText.includes(parsed.data.includes),
      expected: `body containing ${parsed.data.includes}`,
      actual: boundedActual(response.bodyText),
      fingerprintInput: { kind: parsed.data.kind, includes: parsed.data.includes },
    };
  }

  const contentType = response.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw invalidInput("JSON assertion requires a JSON response content type.");
  }
  let current: unknown;
  try {
    current = JSON.parse(response.bodyText);
  } catch (error) {
    throw invalidInput("JSON assertion requires a valid JSON response body.", error);
  }
  for (const segment of parsed.data.path) {
    const object = z.record(z.string(), z.unknown()).safeParse(current);
    if (!object.success || !Object.prototype.hasOwnProperty.call(object.data, segment)) {
      throw invalidInput("JSON assertion path is not present in the response.");
    }
    current = object.data[segment];
  }
  const actual = jsonScalarSchema.safeParse(current);
  if (!actual.success) {
    throw invalidInput("JSON assertion path does not resolve to a scalar value.");
  }
  return {
    passed: Object.is(actual.data, parsed.data.equals),
    expected: `JSON ${parsed.data.path.join(".")} equals ${jsonScalarText(parsed.data.equals)}`,
    actual: jsonScalarText(actual.data),
    fingerprintInput: {
      kind: parsed.data.kind,
      path: parsed.data.path,
      equals: parsed.data.equals,
    },
  };
}

export function redactLiveApiText(
  value: string,
  secrets: readonly string[],
  truncated = false,
): string {
  return truncated ? redactTruncatedText(value, secrets) : redactText(value, secrets);
}
