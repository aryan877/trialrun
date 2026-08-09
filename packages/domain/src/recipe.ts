import { createHash } from "node:crypto";

import { z } from "zod";

export const supportedZeropsApplicationTypes = [
  "alpine@3.23",
  "ubuntu@24.04",
  "ubuntu@22.04",
  "alpine/go@1.22",
  "ubuntu/go@1.22",
  "alpine/php-apache@8.5+2.4",
  "ubuntu/php-apache@8.5+2.4",
  "alpine/php-nginx@8.5+1.28",
  "ubuntu/php-nginx@8.5+1.28",
  "alpine/dotnet@10",
  "ubuntu/dotnet@10",
  "alpine/dotnet@9",
  "ubuntu/dotnet@9",
  "alpine/dotnet@8",
  "ubuntu/dotnet@8",
  "alpine/nodejs@24",
  "ubuntu/nodejs@24",
  "alpine/nodejs@22",
  "ubuntu/nodejs@22",
  "alpine/nodejs@20",
  "ubuntu/nodejs@20",
  "ubuntu/python@3.14",
  "alpine/python@3.12",
  "ubuntu/python@3.12",
  "alpine/python@3.11",
  "ubuntu/python@3.11",
  "alpine/ruby@4.0",
  "ubuntu/ruby@4.0",
  "alpine/ruby@3.4",
  "ubuntu/ruby@3.4",
  "alpine/rust@stable",
  "ubuntu/rust@stable",
  "alpine/bun@1.3.9",
  "ubuntu/bun@1.3.9",
  "alpine/bun@1.2.2",
  "ubuntu/bun@1.2.2",
  "ubuntu/deno@2.0.0",
  "alpine/elixir@1.16.3",
  "ubuntu/elixir@1.16.2",
  "alpine/gleam@1.5.1",
  "ubuntu/gleam@1.5.1",
  "alpine/java@21",
  "ubuntu/java@21",
  "alpine/java@17",
  "ubuntu/java@17",
  "alpine/nginx@1.22",
  "ubuntu/nginx@1.22",
  "alpine/static@1.0",
  "ubuntu/static@1.0",
] as const;

export const supportedZeropsRuntimeTypes = [
  ...supportedZeropsApplicationTypes,
] as const;

export const supportedZeropsBuildTypes = [
  "alpine@3.23",
  "ubuntu@24.04",
  "ubuntu@22.04",
  "alpine/go@1.22",
  "ubuntu/go@1.22",
  "alpine/php@8.5",
  "ubuntu/php@8.5",
  "alpine/dotnet@10",
  "ubuntu/dotnet@10",
  "alpine/dotnet@9",
  "ubuntu/dotnet@9",
  "alpine/dotnet@8",
  "ubuntu/dotnet@8",
  "alpine/nodejs@24",
  "ubuntu/nodejs@24",
  "alpine/nodejs@22",
  "ubuntu/nodejs@22",
  "alpine/nodejs@20",
  "ubuntu/nodejs@20",
  "ubuntu/python@3.14",
  "alpine/python@3.12",
  "ubuntu/python@3.12",
  "alpine/python@3.11",
  "ubuntu/python@3.11",
  "alpine/ruby@4.0",
  "ubuntu/ruby@4.0",
  "alpine/ruby@3.4",
  "ubuntu/ruby@3.4",
  "alpine/rust@stable",
  "ubuntu/rust@stable",
  "alpine/bun@1.3.9",
  "ubuntu/bun@1.3.9",
  "alpine/bun@1.2.2",
  "ubuntu/bun@1.2.2",
  "ubuntu/deno@2.0.0",
  "alpine/elixir@1.16.3",
  "ubuntu/elixir@1.16.2",
  "alpine/gleam@1.5.1",
  "ubuntu/gleam@1.5.1",
  "alpine/java@21",
  "ubuntu/java@21",
  "alpine/java@17",
  "ubuntu/java@17",
] as const;

export const supportedZeropsManagedTypes = [
  "postgresql:single@18",
  "postgresql:single@17",
  "postgresql:single@16",
  "postgresql:single@14",
  "mariadb:single@10.6",
  "valkey:single@7.2",
  "qdrant:single@1.12",
  "qdrant:single@1.10",
  "nats:single@2.12",
  "nats:single@2.10",
  "kafka:single@3.9",
  "elasticsearch:single@9.2",
  "elasticsearch:single@8.16",
  "meilisearch:single@1.44",
  "meilisearch:single@1.20",
  "meilisearch:single@1.10",
  "typesense:single@30.2",
  "typesense:single@27.1",
  "clickhouse:single@25.3",
  "object-storage",
  "shared-storage:single",
] as const;

export type ZeropsManagedType = (typeof supportedZeropsManagedTypes)[number];

const postgresqlSourceProperties = [
  "connectionString",
  "connectionTlsString",
  "hostname",
  "port",
  "portTls",
  "user",
  "password",
  "dbName",
] as const;
const mariadbSourceProperties = [
  "connectionString",
  "hostname",
  "port",
  "user",
  "password",
  "dbName",
] as const;
const valkeySourceProperties = [
  "connectionString",
  "connectionTlsString",
  "hostname",
  "port",
  "portTls",
  "password",
] as const;
const qdrantSourceProperties = [
  "connectionString",
  "grpcConnectionString",
  "hostname",
  "port",
  "grpcPort",
  "apiKey",
  "readOnlyApiKey",
] as const;
const natsSourceProperties = ["connectionString", "hostname", "port", "user", "password"] as const;
const kafkaSourceProperties = ["hostname", "port", "user", "password"] as const;
const elasticsearchSourceProperties = [
  "connectionString",
  "hostname",
  "port",
  "user",
  "password",
] as const;
const meilisearchSourceProperties = [
  "connectionString",
  "hostname",
  "port",
  "defaultAdminKey",
  "defaultSearchKey",
] as const;
const typesenseSourceProperties = ["connectionString", "hostname", "port", "apiKey"] as const;
const clickhouseSourceProperties = [
  "connectionString",
  "hostname",
  "port",
  "portNative",
  "portHttp",
  "portMysql",
  "portPostgresql",
  "user",
  "password",
  "dbName",
] as const;

export const managedServiceSourceProperties = {
  "postgresql:single@18": postgresqlSourceProperties,
  "postgresql:single@17": postgresqlSourceProperties,
  "postgresql:single@16": postgresqlSourceProperties,
  "postgresql:single@14": postgresqlSourceProperties,
  "mariadb:single@10.6": mariadbSourceProperties,
  "valkey:single@7.2": valkeySourceProperties,
  "qdrant:single@1.12": qdrantSourceProperties,
  "qdrant:single@1.10": qdrantSourceProperties,
  "nats:single@2.12": natsSourceProperties,
  "nats:single@2.10": natsSourceProperties,
  "kafka:single@3.9": kafkaSourceProperties,
  "elasticsearch:single@9.2": elasticsearchSourceProperties,
  "elasticsearch:single@8.16": elasticsearchSourceProperties,
  "meilisearch:single@1.44": meilisearchSourceProperties,
  "meilisearch:single@1.20": meilisearchSourceProperties,
  "meilisearch:single@1.10": meilisearchSourceProperties,
  "typesense:single@30.2": typesenseSourceProperties,
  "typesense:single@27.1": typesenseSourceProperties,
  "clickhouse:single@25.3": clickhouseSourceProperties,
  "object-storage": ["apiUrl", "accessKeyId", "secretAccessKey", "bucketName"],
  "shared-storage:single": [],
} as const satisfies Record<ZeropsManagedType, readonly string[]>;

export function isAllowedManagedServiceSourceProperty(
  type: ZeropsManagedType,
  sourceProperty: string,
): boolean {
  const allowedProperties: readonly string[] = managedServiceSourceProperties[type];
  return allowedProperties.includes(sourceProperty);
}

export const zeropsApplicationTypeSchema = z.enum(supportedZeropsApplicationTypes);
export const zeropsRuntimeTypeSchema = z.enum(supportedZeropsRuntimeTypes);
export const zeropsBuildTypeSchema = z.enum(supportedZeropsBuildTypes);
export const zeropsManagedTypeSchema = z.enum(supportedZeropsManagedTypes);

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/, "Expected a lowercase 40-character Git SHA.");
const serviceNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]{0,19}$/, "Use a short lowercase service name without punctuation.");
const environmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const setupNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const deploymentCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => !value.includes("\0"), "Deployment commands cannot contain NUL bytes.");

export const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => {
    if (value === ".") return true;
    const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) <= 0x1f);
    if (value.startsWith("/") || value.includes("\\") || hasControlCharacter) return false;
    const segments = value.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  }, "Expected a normalized relative path that cannot escape the checkout.");

export const evidenceCitationSchema = z
  .strictObject({
    path: safeRelativePathSchema.refine(
      (value) => value !== ".",
      "A citation must identify a repository file.",
    ),
    lineStart: z.number().int().positive().max(1_000_000),
    lineEnd: z.number().int().positive().max(1_000_000),
    summary: z.string().min(1).max(300),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .superRefine((citation, context) => {
    if (citation.lineEnd < citation.lineStart) {
      context.addIssue({
        code: "custom",
        path: ["lineEnd"],
        message: "lineEnd cannot precede lineStart.",
      });
    }
  });

export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;

export const serviceResourcesSchema = z
  .strictObject({
    minCpu: z.number().int().min(1).max(8),
    maxCpu: z.number().int().min(1).max(8),
    minRamGb: z.number().min(0.25).max(32).multipleOf(0.25),
    maxRamGb: z.number().min(0.25).max(32).multipleOf(0.25),
    minDiskGb: z.number().int().min(1).max(100),
    maxDiskGb: z.number().int().min(1).max(100),
  })
  .superRefine((resources, context) => {
    if (resources.minCpu > resources.maxCpu) {
      context.addIssue({
        code: "custom",
        path: ["maxCpu"],
        message: "maxCpu must be at least minCpu.",
      });
    }
    if (resources.minRamGb > resources.maxRamGb) {
      context.addIssue({
        code: "custom",
        path: ["maxRamGb"],
        message: "maxRamGb must be at least minRamGb.",
      });
    }
    if (resources.minDiskGb > resources.maxDiskGb) {
      context.addIssue({
        code: "custom",
        path: ["maxDiskGb"],
        message: "maxDiskGb must be at least minDiskGb.",
      });
    }
  });

const applicationBuildPlanSchema = z.strictObject({
  base: zeropsBuildTypeSchema,
  buildCommands: z.array(deploymentCommandSchema).max(40),
  deployFiles: z
    .array(safeRelativePathSchema)
    .min(1)
    .max(40)
    .refine((paths) => new Set(paths).size === paths.length, "Deploy paths must be unique."),
});

const applicationRunPlanSchema = z.strictObject({
  start: deploymentCommandSchema,
});

export const proposedApplicationServiceSchema = z
  .strictObject({
    name: serviceNameSchema,
    zeropsType: zeropsApplicationTypeSchema,
    sourceRoot: safeRelativePathSchema,
    setup: setupNameSchema,
    port: z.number().int().min(10).max(65_435),
    healthPath: z
      .string()
      .regex(/^\/(?!\/)[^\s?#]*$/)
      .max(300),
    build: applicationBuildPlanSchema,
    run: applicationRunPlanSchema,
    testTarget: z.boolean(),
    publicAccess: z.boolean(),
    resources: serviceResourcesSchema,
    evidence: z.array(evidenceCitationSchema).min(1).max(12),
  })
  .superRefine((application, context) => {
    const runtimeOs = application.zeropsType.startsWith("alpine") ? "alpine" : "ubuntu";
    if (!application.build.base.startsWith(`${runtimeOs}`)) {
      context.addIssue({
        code: "custom",
        path: ["build", "base"],
        message: "Build and runtime bases must use the same operating system.",
      });
    }
  });

export const proposedManagedDependencySchema = z
  .strictObject({
    name: serviceNameSchema,
    zeropsType: zeropsManagedTypeSchema,
    purpose: z.string().min(1).max(240),
    resources: serviceResourcesSchema.optional(),
    storageSizeGb: z.number().int().min(1).max(20).optional(),
    evidence: z.array(evidenceCitationSchema).min(1).max(12),
  })
  .superRefine((dependency, context) => {
    if (dependency.zeropsType === "object-storage") {
      if (!dependency.storageSizeGb) {
        context.addIssue({
          code: "custom",
          path: ["storageSizeGb"],
          message: "Object storage needs a size.",
        });
      }
      if (dependency.resources) {
        context.addIssue({
          code: "custom",
          path: ["resources"],
          message: "Object storage does not accept runtime resources.",
        });
      }
      return;
    }
    if (!dependency.resources) {
      context.addIssue({
        code: "custom",
        path: ["resources"],
        message: "Managed services need bounded resources.",
      });
    }
    if (dependency.storageSizeGb) {
      context.addIssue({
        code: "custom",
        path: ["storageSizeGb"],
        message: "Only object storage uses storageSizeGb.",
      });
    }
  });

export const serviceEnvironmentBindingSchema = z.strictObject({
  targetService: serviceNameSchema,
  environmentName: environmentNameSchema,
  sourceService: serviceNameSchema,
  sourceProperty: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,79}$/),
  evidence: z.array(evidenceCitationSchema).min(1).max(8),
});

export const serviceSecretBindingSchema = z.strictObject({
  targetService: serviceNameSchema,
  environmentName: environmentNameSchema,
  secretName: environmentNameSchema,
  evidence: z.array(evidenceCitationSchema).min(1).max(8),
});

export const infrastructureProposalSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sourceSha: shaSchema,
    summary: z.string().min(1).max(800),
    applications: z.array(proposedApplicationServiceSchema).min(1).max(6),
    dependencies: z.array(proposedManagedDependencySchema).max(8),
    environmentBindings: z.array(serviceEnvironmentBindingSchema).max(40),
    secretBindings: z.array(serviceSecretBindingSchema).max(40),
    unresolvedQuestions: z.array(z.string().min(1).max(300)).max(12),
  })
  .superRefine((proposal, context) => {
    const allNames = [...proposal.applications, ...proposal.dependencies].map(({ name }) => name);
    if (new Set(allNames).size !== allNames.length) {
      context.addIssue({
        code: "custom",
        path: ["applications"],
        message: "All service names must be unique.",
      });
    }
    if (proposal.applications.filter(({ testTarget }) => testTarget).length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["applications"],
        message: "Exactly one application must be the test target.",
      });
    }

    const applicationNames = new Set(proposal.applications.map(({ name }) => name));
    const serviceNames = new Set(allNames);
    const dependenciesByName = new Map(
      proposal.dependencies.map((dependency) => [dependency.name, dependency]),
    );
    const bindingKeys = new Set<string>();
    for (const [index, binding] of proposal.environmentBindings.entries()) {
      if (!applicationNames.has(binding.targetService)) {
        context.addIssue({
          code: "custom",
          path: ["environmentBindings", index, "targetService"],
          message: "Binding targets must be application services.",
        });
      }
      if (!serviceNames.has(binding.sourceService)) {
        context.addIssue({
          code: "custom",
          path: ["environmentBindings", index, "sourceService"],
          message: "Binding source service does not exist.",
        });
      }
      const sourceDependency = dependenciesByName.get(binding.sourceService);
      if (
        sourceDependency &&
        !isAllowedManagedServiceSourceProperty(sourceDependency.zeropsType, binding.sourceProperty)
      ) {
        const allowed = managedServiceSourceProperties[sourceDependency.zeropsType];
        context.addIssue({
          code: "custom",
          path: ["environmentBindings", index, "sourceProperty"],
          message:
            allowed.length > 0
              ? `${binding.sourceProperty} is not an allowed ${sourceDependency.zeropsType} application connection property. Allowed: ${allowed.join(", ")}.`
              : `${sourceDependency.zeropsType} does not expose application connection properties for environment bindings.`,
        });
      }
      const key = `${binding.targetService}:${binding.environmentName}`;
      if (bindingKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["environmentBindings", index],
          message: "A target environment variable can be bound only once.",
        });
      }
      bindingKeys.add(key);
    }
    for (const [index, binding] of proposal.secretBindings.entries()) {
      if (!applicationNames.has(binding.targetService)) {
        context.addIssue({
          code: "custom",
          path: ["secretBindings", index, "targetService"],
          message: "Secret bindings must target application services.",
        });
      }
      const key = `${binding.targetService}:${binding.environmentName}`;
      if (bindingKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["secretBindings", index],
          message: "A target environment variable can be bound only once.",
        });
      }
      bindingKeys.add(key);
    }
  });

export type InfrastructureProposal = z.infer<typeof infrastructureProposalSchema>;

export const policyApprovedRecipePayloadSchema = z.strictObject({
  policyVersion: z.literal(1),
  sourceSha: shaSchema,
  summary: z.string().min(1).max(800),
  primaryService: serviceNameSchema,
  applications: z.array(proposedApplicationServiceSchema).min(1).max(3),
  dependencies: z.array(proposedManagedDependencySchema).max(4),
  environmentBindings: z.array(serviceEnvironmentBindingSchema).max(40),
  secretBindings: z.array(serviceSecretBindingSchema).max(40),
});

export type PolicyApprovedRecipePayload = z.infer<typeof policyApprovedRecipePayloadSchema>;

export function computePolicyApprovedRecipeFingerprint(input: unknown): string {
  const payload = policyApprovedRecipePayloadSchema.parse(input);
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export const policyApprovedRecipeSchema = policyApprovedRecipePayloadSchema
  .extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) })
  .superRefine((recipe, context) => {
    const { fingerprint, ...payload } = recipe;
    if (fingerprint !== computePolicyApprovedRecipeFingerprint(payload)) {
      context.addIssue({
        code: "custom",
        path: ["fingerprint"],
        message: "Recipe fingerprint does not match its policy-approved payload.",
      });
    }
  });

export type PolicyApprovedRecipe = z.infer<typeof policyApprovedRecipeSchema>;

export interface PolicyIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type InfrastructurePolicyDecision =
  | {
      readonly accepted: false;
      readonly errors: readonly PolicyIssue[];
      readonly warnings: readonly PolicyIssue[];
    }
  | {
      readonly accepted: true;
      readonly recipe: PolicyApprovedRecipe;
      readonly errors: readonly [];
      readonly warnings: readonly PolicyIssue[];
    };

const applicationCaps = { cpu: 2, ramGb: 4, diskGb: 10 } as const;
const dependencyCaps = { cpu: 2, ramGb: 4, diskGb: 10, objectStorageGb: 5 } as const;
export const reviewResourceCeilings = {
  importedServices: 9,
  maxCpu: 12,
  maxRamGb: 24,
  maxDiskGb: 60,
  objectStorageGb: 10,
} as const;
const executorResources = { cpu: 2, ramGb: 4, diskGb: 10 } as const;

function issuePath(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

function clampResources(
  resources: z.infer<typeof serviceResourcesSchema>,
  path: string,
  caps: typeof applicationCaps,
  warnings: PolicyIssue[],
): z.infer<typeof serviceResourcesSchema> {
  const minCpu = Math.min(resources.minCpu, caps.cpu);
  const maxCpu = Math.max(minCpu, Math.min(resources.maxCpu, caps.cpu));
  const minRamGb = Math.min(resources.minRamGb, caps.ramGb);
  const maxRamGb = Math.max(minRamGb, Math.min(resources.maxRamGb, caps.ramGb));
  const minDiskGb = Math.min(resources.minDiskGb, caps.diskGb);
  const maxDiskGb = Math.max(minDiskGb, Math.min(resources.maxDiskGb, caps.diskGb));
  const normalized = { minCpu, maxCpu, minRamGb, maxRamGb, minDiskGb, maxDiskGb };
  if (JSON.stringify(normalized) !== JSON.stringify(resources)) {
    warnings.push({
      code: "resource_clamped",
      path,
      message: "Resources were clamped to the TrialRun review ceiling.",
    });
  }
  return normalized;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = z.record(z.string(), z.unknown()).parse(value);
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function applyInfrastructurePolicy(input: unknown): InfrastructurePolicyDecision {
  const parsed = infrastructureProposalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      accepted: false,
      errors: parsed.error.issues.map((issue) => ({
        code: `schema_${issue.code}`,
        path: issuePath(issue.path),
        message: issue.message,
      })),
      warnings: [],
    };
  }

  const proposal = parsed.data;
  const errors: PolicyIssue[] = [];
  const warnings: PolicyIssue[] = [];
  if (proposal.applications.length > 3) {
    errors.push({
      code: "too_many_applications",
      path: "applications",
      message: "A review supports at most three application services.",
    });
  }
  if (proposal.dependencies.length > 4) {
    errors.push({
      code: "too_many_dependencies",
      path: "dependencies",
      message: "A review supports at most four managed dependencies.",
    });
  }
  const importedServiceCount =
    2 * (proposal.applications.length + proposal.dependencies.length) + 1;
  if (importedServiceCount > reviewResourceCeilings.importedServices) {
    errors.push({
      code: "too_many_review_services",
      path: "applications",
      message: `The duplicated review would import ${importedServiceCount} services; the ceiling is ${reviewResourceCeilings.importedServices}, including the executor.`,
    });
  }
  if (proposal.unresolvedQuestions.length > 0) {
    errors.push({
      code: "unresolved_questions",
      path: "unresolvedQuestions",
      message: "A maintainer must resolve every topology question before confirmation.",
    });
  }
  for (const [index, application] of proposal.applications.entries()) {
    if (application.publicAccess) {
      errors.push({
        code: "public_application",
        path: `applications.${index}.publicAccess`,
        message: "Reviewed applications must remain private inside the disposable project.",
      });
    }
  }
  if (errors.length > 0) return { accepted: false, errors, warnings };

  const applications = proposal.applications.map((application, index) => ({
    ...application,
    publicAccess: false,
    resources: clampResources(
      application.resources,
      `applications.${index}.resources`,
      applicationCaps,
      warnings,
    ),
  }));
  const dependencies = proposal.dependencies.map((dependency, index) => {
    if (dependency.zeropsType === "object-storage") {
      const storageSizeGb = Math.min(dependency.storageSizeGb ?? 1, dependencyCaps.objectStorageGb);
      if (storageSizeGb !== dependency.storageSizeGb) {
        warnings.push({
          code: "storage_clamped",
          path: `dependencies.${index}.storageSizeGb`,
          message: "Object storage was clamped to the TrialRun review ceiling.",
        });
      }
      return { ...dependency, storageSizeGb };
    }
    return {
      ...dependency,
      resources: clampResources(
        dependency.resources ?? {
          minCpu: 1,
          maxCpu: 1,
          minRamGb: 0.5,
          maxRamGb: 1,
          minDiskGb: 1,
          maxDiskGb: 2,
        },
        `dependencies.${index}.resources`,
        dependencyCaps,
        warnings,
      ),
    };
  });
  const applicationResourceTotals = applications.reduce(
    (totals, application) => ({
      cpu: totals.cpu + application.resources.maxCpu,
      ramGb: totals.ramGb + application.resources.maxRamGb,
      diskGb: totals.diskGb + application.resources.maxDiskGb,
    }),
    { cpu: 0, ramGb: 0, diskGb: 0 },
  );
  const dependencyResourceTotals = dependencies.reduce(
    (totals, dependency) => ({
      cpu: totals.cpu + (dependency.resources?.maxCpu ?? 0),
      ramGb: totals.ramGb + (dependency.resources?.maxRamGb ?? 0),
      diskGb: totals.diskGb + (dependency.resources?.maxDiskGb ?? 0),
      objectStorageGb:
        totals.objectStorageGb +
        (dependency.zeropsType === "object-storage" ? (dependency.storageSizeGb ?? 0) : 0),
    }),
    { cpu: 0, ramGb: 0, diskGb: 0, objectStorageGb: 0 },
  );
  const reviewResourceTotals = {
    cpu: executorResources.cpu + 2 * (applicationResourceTotals.cpu + dependencyResourceTotals.cpu),
    ramGb:
      executorResources.ramGb +
      2 * (applicationResourceTotals.ramGb + dependencyResourceTotals.ramGb),
    diskGb:
      executorResources.diskGb +
      2 * (applicationResourceTotals.diskGb + dependencyResourceTotals.diskGb),
    objectStorageGb: 2 * dependencyResourceTotals.objectStorageGb,
  };
  if (reviewResourceTotals.cpu > reviewResourceCeilings.maxCpu) {
    errors.push({
      code: "aggregate_cpu_exceeded",
      path: "applications",
      message: `The duplicated review requests ${reviewResourceTotals.cpu} max CPU; the ceiling is ${reviewResourceCeilings.maxCpu}.`,
    });
  }
  if (reviewResourceTotals.ramGb > reviewResourceCeilings.maxRamGb) {
    errors.push({
      code: "aggregate_ram_exceeded",
      path: "applications",
      message: `The duplicated review requests ${reviewResourceTotals.ramGb} GiB max RAM; the ceiling is ${reviewResourceCeilings.maxRamGb} GiB.`,
    });
  }
  if (reviewResourceTotals.diskGb > reviewResourceCeilings.maxDiskGb) {
    errors.push({
      code: "aggregate_disk_exceeded",
      path: "applications",
      message: `The duplicated review requests ${reviewResourceTotals.diskGb} GiB max disk; the ceiling is ${reviewResourceCeilings.maxDiskGb} GiB.`,
    });
  }
  if (reviewResourceTotals.objectStorageGb > reviewResourceCeilings.objectStorageGb) {
    errors.push({
      code: "aggregate_object_storage_exceeded",
      path: "dependencies",
      message: `The duplicated review requests ${reviewResourceTotals.objectStorageGb} GiB object storage; the ceiling is ${reviewResourceCeilings.objectStorageGb} GiB.`,
    });
  }
  if (errors.length > 0) return { accepted: false, errors, warnings };

  const withoutFingerprint = {
    policyVersion: 1 as const,
    sourceSha: proposal.sourceSha,
    summary: proposal.summary,
    primaryService: applications.find(({ testTarget }) => testTarget)?.name ?? "",
    applications,
    dependencies,
    environmentBindings: proposal.environmentBindings,
    secretBindings: proposal.secretBindings,
  };
  const fingerprint = computePolicyApprovedRecipeFingerprint(withoutFingerprint);
  const recipe = policyApprovedRecipeSchema.parse({ ...withoutFingerprint, fingerprint });
  return { accepted: true, recipe, errors: [], warnings };
}

export interface CompiledZeropsService {
  readonly hostname: string;
  readonly type: string;
  readonly enableSubdomainAccess?: boolean;
  readonly objectStorageSize?: number;
  readonly objectStoragePolicy?: "private";
  readonly verticalAutoscaling?: {
    readonly cpuMode: "SHARED";
  } & (
    | {
        readonly minCpu: number;
        readonly maxCpu: number;
        readonly minRam: number;
        readonly maxRam: number;
        readonly minDisk: number;
        readonly maxDisk: number;
      }
    | {
        readonly cpu: number;
        readonly ram: number;
        readonly disk: number;
      }
  );
  readonly envSecrets?: Readonly<Record<string, string>>;
}

interface CompiledDeploymentTargetCommon {
  readonly logicalService: string;
  readonly hostname: string;
  readonly sourceRoot: string;
  readonly setup: string;
  readonly port: number;
  readonly healthPath: string;
  readonly environmentBindings: readonly {
    readonly environmentName: string;
    readonly sourceService: string;
    readonly sourceHostname: string;
    readonly sourceProperty: string;
  }[];
  readonly secretBindings: readonly { environmentName: string; secretName: string }[];
}

export type CompiledDeploymentTarget = CompiledDeploymentTargetCommon &
  (
    | {
        readonly side: "base" | "head";
        readonly sha: string;
        readonly build: {
          readonly base: z.infer<typeof zeropsBuildTypeSchema>;
          readonly buildCommands: readonly string[];
          readonly deployFiles: readonly string[];
        };
        readonly run: {
          readonly base: z.infer<typeof zeropsApplicationTypeSchema>;
          readonly start: string;
        };
      }
    | {
        readonly side: "executor";
        readonly sha: null;
      }
  );

export interface CompiledZeropsReviewTopology {
  readonly project: {
    readonly name: string;
    readonly description: string;
    readonly corePackage: "LIGHT";
    readonly tags: readonly ["trialrun", "ephemeral-review"];
  };
  readonly services: readonly CompiledZeropsService[];
  readonly deployments: readonly CompiledDeploymentTarget[];
}

function resourcesForImport(
  resources: z.infer<typeof serviceResourcesSchema>,
): NonNullable<CompiledZeropsService["verticalAutoscaling"]> {
  return {
    cpuMode: "SHARED",
    minCpu: resources.minCpu,
    maxCpu: resources.maxCpu,
    minRam: resources.minRamGb,
    maxRam: resources.maxRamGb,
    minDisk: resources.minDiskGb,
    maxDisk: resources.maxDiskGb,
  };
}

function sideHostname(side: "base" | "head", logicalName: string): string {
  return `${side}${logicalName}`;
}

export function compileZeropsReviewTopology(
  recipeInput: unknown,
  input: { readonly reviewId: string; readonly baseSha: string; readonly headSha: string },
): CompiledZeropsReviewTopology {
  const recipe = policyApprovedRecipeSchema.parse(recipeInput);
  const reviewId = z.string().uuid().parse(input.reviewId);
  const baseSha = shaSchema.parse(input.baseSha);
  const headSha = shaSchema.parse(input.headSha);
  const services: CompiledZeropsService[] = [];
  const deployments: CompiledDeploymentTarget[] = [];

  for (const side of ["base", "head"] as const) {
    for (const dependency of recipe.dependencies) {
      services.push({
        hostname: sideHostname(side, dependency.name),
        type: dependency.zeropsType,
        ...(dependency.zeropsType === "object-storage"
          ? {
              objectStorageSize: dependency.storageSizeGb ?? 1,
              objectStoragePolicy: "private" as const,
            }
          : dependency.resources
            ? { verticalAutoscaling: resourcesForImport(dependency.resources) }
            : {}),
      });
    }
    for (const application of recipe.applications) {
      services.push({
        hostname: sideHostname(side, application.name),
        type: application.zeropsType,
        enableSubdomainAccess: false,
        verticalAutoscaling: resourcesForImport(application.resources),
      });
      deployments.push({
        side,
        logicalService: application.name,
        hostname: sideHostname(side, application.name),
        sourceRoot: application.sourceRoot,
        setup: application.setup,
        sha: side === "base" ? baseSha : headSha,
        port: application.port,
        healthPath: application.healthPath,
        build: {
          base: application.build.base,
          buildCommands: application.build.buildCommands,
          deployFiles: application.build.deployFiles,
        },
        run: {
          base: application.zeropsType,
          start: application.run.start,
        },
        environmentBindings: recipe.environmentBindings
          .filter(({ targetService }) => targetService === application.name)
          .map(({ environmentName, sourceService, sourceProperty }) => ({
            environmentName,
            sourceService,
            sourceHostname: sideHostname(side, sourceService),
            sourceProperty,
          })),
        secretBindings: recipe.secretBindings
          .filter(({ targetService }) => targetService === application.name)
          .map(({ environmentName, secretName }) => ({ environmentName, secretName })),
      });
    }
  }

  services.push({
    hostname: "executor",
    type: "ubuntu/nodejs@24",
    enableSubdomainAccess: true,
    verticalAutoscaling: {
      cpuMode: "SHARED",
      minCpu: executorResources.cpu,
      maxCpu: executorResources.cpu,
      minRam: executorResources.ramGb,
      maxRam: executorResources.ramGb,
      minDisk: executorResources.diskGb,
      maxDisk: executorResources.diskGb,
    },
  });
  deployments.push({
    side: "executor",
    logicalService: "executor",
    hostname: "executor",
    sourceRoot: ".",
    setup: "executor",
    sha: null,
    port: 3000,
    healthPath: "/health",
    environmentBindings: [],
    secretBindings: [],
  });

  return {
    project: {
      name: `trialrun-${reviewId.slice(0, 8)}`,
      description: `Disposable TrialRun review ${reviewId}`,
      corePackage: "LIGHT",
      tags: ["trialrun", "ephemeral-review"],
    },
    services,
    deployments,
  };
}
