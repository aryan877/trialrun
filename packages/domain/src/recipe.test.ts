import { describe, expect, it } from "vitest";

import {
  applyInfrastructurePolicy,
  compileZeropsReviewTopology,
  computePolicyApprovedRecipeFingerprint,
  infrastructureProposalSchema,
  isAllowedRepositoryEvidencePath,
  managedServiceSourceProperties,
  policyApprovedRecipeSchema,
  supportedZeropsApplicationTypes,
  supportedZeropsManagedTypes,
  supportedZeropsRuntimeTypes,
  type InfrastructureProposal,
  type ZeropsManagedType,
} from "./recipe";

const sha = "a".repeat(40);
const citation = {
  path: "zerops.yaml",
  lineStart: 1,
  lineEnd: 20,
  summary: "The app setup and runtime are declared here.",
  confidence: "high" as const,
};

function proposal(): InfrastructureProposal {
  return {
    schemaVersion: 1 as const,
    sourceSha: sha,
    summary: "A Node service backed by PostgreSQL.",
    applications: [
      {
        name: "app",
        zeropsType: "alpine/nodejs@24" as const,
        sourceRoot: ".",
        setup: "app",
        port: 3000,
        healthPath: "/health",
        testTarget: true,
        publicAccess: false,
        resources: {
          minCpu: 1,
          maxCpu: 8,
          minRamGb: 0.5,
          maxRamGb: 16,
          minDiskGb: 1,
          maxDiskGb: 40,
        },
        evidence: [citation],
      },
    ],
    dependencies: [
      {
        name: "db",
        zeropsType: "postgresql:single@18" as const,
        purpose: "Stores disposable test data.",
        resources: {
          minCpu: 1,
          maxCpu: 2,
          minRamGb: 0.5,
          maxRamGb: 4,
          minDiskGb: 1,
          maxDiskGb: 10,
        },
        evidence: [{ ...citation, path: "package.json" }],
      },
    ],
    environmentBindings: [
      {
        targetService: "app",
        environmentName: "DATABASE_URL",
        sourceService: "db",
        sourceProperty: "connectionString",
        evidence: [{ ...citation, path: ".env.example" }],
      },
    ],
    secretBindings: [],
    unresolvedQuestions: [],
  };
}

const lowResources = {
  minCpu: 1,
  maxCpu: 1,
  minRamGb: 0.25,
  maxRamGb: 0.25,
  minDiskGb: 1,
  maxDiskGb: 1,
};

function managedDependency(
  name: string,
  zeropsType: ZeropsManagedType,
  resources = lowResources,
): InfrastructureProposal["dependencies"][number] {
  return {
    name,
    zeropsType,
    purpose: "Supports the disposable review.",
    resources: zeropsType === "object-storage" ? undefined : resources,
    storageSizeGb: zeropsType === "object-storage" ? 1 : undefined,
    evidence: [{ ...citation, path: "package.json" }],
  };
}

function proposalForManagedBinding(
  zeropsType: ZeropsManagedType,
  sourceProperty: string,
): InfrastructureProposal {
  const value = proposal();
  value.dependencies = [managedDependency("dependency", zeropsType)];
  value.environmentBindings = [
    {
      targetService: "app",
      environmentName: "SERVICE_VALUE",
      sourceService: "dependency",
      sourceProperty,
      evidence: [{ ...citation, path: ".env.example" }],
    },
  ];
  return value;
}

describe("repository infrastructure policy", () => {
  it("parses a strict cited proposal and clamps review resources", () => {
    expect(infrastructureProposalSchema.safeParse({ ...proposal(), surprise: true }).success).toBe(
      false,
    );
    const decision = applyInfrastructurePolicy(proposal());
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error("Expected the proposal to pass policy.");
    expect(decision.recipe.applications[0]?.resources).toEqual({
      minCpu: 1,
      maxCpu: 2,
      minRamGb: 0.5,
      maxRamGb: 4,
      minDiskGb: 1,
      maxDiskGb: 10,
    });
    expect(decision.warnings.map(({ code }) => code)).toContain("resource_clamped");
  });

  it("rejects Docker as an analyst-selected application while retaining the fixed executor runtime", () => {
    const value = proposal();
    const dockerProposal = {
      ...value,
      applications: value.applications.map((application) => ({
        ...application,
        zeropsType: "alpine/docker@26.1.5",
      })),
    };

    expect(supportedZeropsApplicationTypes).not.toContain("alpine/docker@26.1.5");
    expect(supportedZeropsRuntimeTypes).toContain("alpine/docker@26.1.5");
    const parsed = infrastructureProposalSchema.safeParse(dockerProposal);
    expect(parsed.success).toBe(false);
    if (parsed.success)
      throw new Error("Expected Docker application selection to fail schema validation.");
    expect(
      parsed.error.issues.some(({ path }) => path.join(".") === "applications.0.zeropsType"),
    ).toBe(true);
    expect(applyInfrastructurePolicy(dockerProposal).accepted).toBe(false);
  });

  it("keeps an exact allowlist for every supported managed-service type", () => {
    const postgres = [
      "connectionString",
      "connectionTlsString",
      "hostname",
      "port",
      "portTls",
      "user",
      "password",
      "dbName",
    ];
    const mariadb = ["connectionString", "hostname", "port", "user", "password", "dbName"];
    const valkey = [
      "connectionString",
      "connectionTlsString",
      "hostname",
      "port",
      "portTls",
      "password",
    ];
    const qdrant = [
      "connectionString",
      "grpcConnectionString",
      "hostname",
      "port",
      "grpcPort",
      "apiKey",
      "readOnlyApiKey",
    ];
    const nats = ["connectionString", "hostname", "port", "user", "password"];
    const kafka = ["hostname", "port", "user", "password"];
    const elasticsearch = ["connectionString", "hostname", "port", "user", "password"];
    const meilisearch = [
      "connectionString",
      "hostname",
      "port",
      "defaultAdminKey",
      "defaultSearchKey",
    ];
    const typesense = ["connectionString", "hostname", "port", "apiKey"];
    const clickhouse = [
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
    ];
    const expected = {
      "postgresql:single@18": postgres,
      "postgresql:single@17": postgres,
      "postgresql:single@16": postgres,
      "postgresql:single@14": postgres,
      "mariadb:single@10.6": mariadb,
      "valkey:single@7.2": valkey,
      "qdrant:single@1.12": qdrant,
      "qdrant:single@1.10": qdrant,
      "nats:single@2.12": nats,
      "nats:single@2.10": nats,
      "kafka:single@3.9": kafka,
      "elasticsearch:single@9.2": elasticsearch,
      "elasticsearch:single@8.16": elasticsearch,
      "meilisearch:single@1.44": meilisearch,
      "meilisearch:single@1.20": meilisearch,
      "meilisearch:single@1.10": meilisearch,
      "typesense:single@30.2": typesense,
      "typesense:single@27.1": typesense,
      "clickhouse:single@25.3": clickhouse,
      "object-storage": ["apiUrl", "accessKeyId", "secretAccessKey", "bucketName"],
      "shared-storage:single": [],
    } satisfies Record<ZeropsManagedType, readonly string[]>;

    expect(Object.keys(managedServiceSourceProperties)).toEqual(supportedZeropsManagedTypes);
    expect(managedServiceSourceProperties).toEqual(expected);
  });

  it("rejects invented source properties for every managed type and accepts each declared contract", () => {
    for (const zeropsType of supportedZeropsManagedTypes) {
      const rejected = applyInfrastructurePolicy(
        proposalForManagedBinding(zeropsType, "inventedProperty"),
      );
      expect(rejected.accepted, zeropsType).toBe(false);
      if (rejected.accepted)
        throw new Error(`Expected ${zeropsType} to reject an invented source property.`);
      expect(
        rejected.errors.some(
          ({ path, message }) =>
            path === "environmentBindings.0.sourceProperty" && message.includes(zeropsType),
        ),
        zeropsType,
      ).toBe(true);

      const allowedProperties: readonly string[] = managedServiceSourceProperties[zeropsType];
      const allowedProperty = allowedProperties[0];
      if (allowedProperty) {
        expect(
          applyInfrastructurePolicy(proposalForManagedBinding(zeropsType, allowedProperty))
            .accepted,
          `${zeropsType}.${allowedProperty}`,
        ).toBe(true);
      }
    }
  });

  it("continues to allow repository-defined properties when the binding source is an application", () => {
    const value = proposal();
    value.dependencies = [];
    value.environmentBindings = [
      {
        targetService: "app",
        environmentName: "INTERNAL_VALUE",
        sourceService: "app",
        sourceProperty: "repositoryDefinedValue",
        evidence: [{ ...citation, path: ".env.example" }],
      },
    ];
    expect(applyInfrastructurePolicy(value).accepted).toBe(true);
  });

  it("recomputes fingerprints and rejects a policy recipe changed after approval", () => {
    const decision = applyInfrastructurePolicy(proposal());
    if (!decision.accepted) throw new Error("Expected the proposal to pass policy.");
    const { fingerprint, ...payload } = decision.recipe;
    expect(computePolicyApprovedRecipeFingerprint(payload)).toBe(fingerprint);
    expect(
      policyApprovedRecipeSchema.safeParse(JSON.parse(JSON.stringify(decision.recipe))).success,
    ).toBe(true);

    const tampered = { ...decision.recipe, summary: "Changed after policy approval." };
    const parsed = policyApprovedRecipeSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected a stale fingerprint to fail validation.");
    expect(parsed.error.issues.some(({ path }) => path.join(".") === "fingerprint")).toBe(true);
    expect(() =>
      compileZeropsReviewTopology(tampered, {
        reviewId: "5cfe8c2b-5d56-4c8d-94be-1f0b169ee365",
        baseSha: "b".repeat(40),
        headSha: "c".repeat(40),
      }),
    ).toThrow(/fingerprint/i);
  });

  it("blocks public apps, unresolved topology, and citations outside the allowlist", () => {
    const value = proposal();
    value.applications[0] = { ...value.applications[0]!, publicAccess: true };
    value.unresolvedQuestions = ["Which service owns migrations?"];
    value.dependencies[0] = {
      ...value.dependencies[0]!,
      evidence: [{ ...citation, path: "src/private-config.ts" }],
    };
    const decision = applyInfrastructurePolicy(value);
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error("Expected the proposal to fail policy.");
    expect(decision.errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "public_application",
        "unresolved_questions",
        "unsupported_evidence",
      ]),
    );
  });

  it("rejects reviews that exceed aggregate CPU, RAM, disk, object-storage, or service ceilings", () => {
    const rejectionCodes = (value: InfrastructureProposal): readonly string[] => {
      const decision = applyInfrastructurePolicy(value);
      expect(decision.accepted).toBe(false);
      if (decision.accepted)
        throw new Error("Expected the aggregate review ceiling to reject the proposal.");
      return decision.errors.map(({ code }) => code);
    };

    const cpuHeavy = proposal();
    cpuHeavy.dependencies.push(
      managedDependency("cache", "valkey:single@7.2", {
        ...lowResources,
        maxCpu: 2,
      }),
    );
    expect(rejectionCodes(cpuHeavy)).toContain("aggregate_cpu_exceeded");

    const ramHeavy = proposal();
    ramHeavy.dependencies.push(
      managedDependency("cache", "valkey:single@7.2", {
        ...lowResources,
        maxRamGb: 4,
      }),
    );
    expect(rejectionCodes(ramHeavy)).toContain("aggregate_ram_exceeded");

    const diskHeavy = proposal();
    diskHeavy.dependencies.push(
      managedDependency("cache", "valkey:single@7.2", {
        ...lowResources,
        maxDiskGb: 10,
      }),
    );
    expect(rejectionCodes(diskHeavy)).toContain("aggregate_disk_exceeded");

    const storageHeavy = proposal();
    storageHeavy.dependencies.push(
      { ...managedDependency("assets", "object-storage"), storageSizeGb: 5 },
      { ...managedDependency("uploads", "object-storage"), storageSizeGb: 5 },
    );
    expect(rejectionCodes(storageHeavy)).toContain("aggregate_object_storage_exceeded");

    const serviceHeavy = proposal();
    serviceHeavy.dependencies.push(
      managedDependency("cache", "valkey:single@7.2"),
      managedDependency("queue", "nats:single@2.12"),
      managedDependency("search", "meilisearch:single@1.44"),
    );
    expect(rejectionCodes(serviceHeavy)).toContain("too_many_review_services");
  });

  it("duplicates all state and rewrites bindings for base and head", () => {
    const decision = applyInfrastructurePolicy(proposal());
    if (!decision.accepted) throw new Error("Expected the proposal to pass policy.");
    const topology = compileZeropsReviewTopology(decision.recipe, {
      reviewId: "5cfe8c2b-5d56-4c8d-94be-1f0b169ee365",
      baseSha: "b".repeat(40),
      headSha: "c".repeat(40),
    });
    expect(topology.services.map(({ hostname }) => hostname)).toEqual([
      "basedb",
      "baseapp",
      "headdb",
      "headapp",
      "executor",
    ]);
    expect(
      topology.services.find(({ hostname }) => hostname === "baseapp")?.envSecrets,
    ).toBeUndefined();
    expect(
      topology.services.find(({ hostname }) => hostname === "headapp")?.envSecrets,
    ).toBeUndefined();
    expect(
      topology.deployments.find(({ hostname }) => hostname === "baseapp")?.environmentBindings,
    ).toEqual([
      {
        environmentName: "DATABASE_URL",
        sourceService: "db",
        sourceHostname: "basedb",
        sourceProperty: "connectionString",
      },
    ]);
    expect(
      topology.deployments.find(({ hostname }) => hostname === "headapp")?.environmentBindings,
    ).toEqual([
      {
        environmentName: "DATABASE_URL",
        sourceService: "db",
        sourceHostname: "headdb",
        sourceProperty: "connectionString",
      },
    ]);
    expect(topology.services.find(({ hostname }) => hostname === "executor")?.type).toBe(
      "alpine/docker@26.1.5",
    );
    expect(
      topology.services
        .filter(({ hostname }) => hostname !== "executor")
        .every(({ enableSubdomainAccess }) => enableSubdomainAccess !== true),
    ).toBe(true);
  });

  it("accepts only bounded manifest evidence paths", () => {
    expect(isAllowedRepositoryEvidencePath("apps/web/package.json")).toBe(true);
    expect(isAllowedRepositoryEvidencePath("packages/db/prisma/schema.prisma")).toBe(true);
    expect(isAllowedRepositoryEvidencePath("../.env")).toBe(false);
    expect(isAllowedRepositoryEvidencePath("src/server.ts")).toBe(false);
  });
});
