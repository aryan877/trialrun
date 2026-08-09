import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  ZeropsWorkspacePlatformClient,
  type WorkspaceSourcePusher,
} from "./workspace-platform";

const connectionId = "11111111-1111-4111-8111-111111111111";
const projectId = "project-proof";
const serviceId = "service-proof";
const clientId = "client-proof";
const ownershipHash = "a".repeat(64);
const description = `TrialRun Codex workspace ${connectionId}; ownership-sha256=${ownershipHash}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function sourceDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "trialrun-workspace-source-"));
  directories.push(path);
  await writeFile(path + "/zerops.yaml", "zerops: []\n", "utf8");
  return path;
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ownedProject(): object {
  return {
    id: projectId,
    clientId,
    description,
    tagList: ["trialrun", "codex-workspace"],
    status: "ACTIVE",
  };
}

function workspaceService(input: {
  readonly subdomainAccess: boolean;
  readonly subdomainUrl?: string;
}): object {
  return {
    id: serviceId,
    projectId,
    name: "codexworkspace",
    subdomainAccess: input.subdomainAccess,
    userData: input.subdomainUrl
      ? [{ key: "zeropsSubdomain", content: input.subdomainUrl }]
      : [],
  };
}

function projectNotFound(): Response {
  return json({ error: { code: "projectNotFound", message: "Project not found." } }, 400);
}

describe("Zerops Codex workspace platform", () => {
  it("persists returned IDs before waiting, validates ownership, pushes the bundle, and gates health", async () => {
    const order: string[] = [];
    const pushed: Parameters<WorkspaceSourcePusher["push"]>[0][] = [];
    let serviceReads = 0;
    const client = new ZeropsWorkspacePlatformClient({
      apiUrl: "https://api.app-prg1.zerops.io/api/rest/public",
      accessToken: "secret-zerops-token",
      clientId,
      sourceDirectory: await sourceDirectory(),
      fetchFunction: async (url, init) => {
        await Promise.resolve();
        const path = new URL(url).pathname.replace("/api/rest/public", "");
        if (path === "/settings/import-project-yml-json-schema.json") {
          return json({
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          });
        }
        if (path === `/client/${clientId}/project/import`) {
          if (typeof init.body !== "string") throw new Error("Expected a JSON import body.");
          const request = JSON.parse(init.body) as { yaml: string };
          const imported = parseYaml(request.yaml) as {
            services: Array<{ envSecrets: Record<string, string> }>;
          };
          expect(imported.services[0]?.envSecrets).toEqual({
            TRIALRUN_BRIDGE_AUDIENCE: `agent-connection:${connectionId}`,
            TRIALRUN_BRIDGE_PUBLIC_KEY_BASE64: "cHVibGljLWtleQ==",
            TRIALRUN_REPOSITORY_MCP_URL:
              "https://trialrun.aryankumar.dev/api/agent-tools/repository/mcp",
          });
          expect(imported.services[0]?.envSecrets).not.toHaveProperty("ZCP_API_KEY");
          order.push("imported");
          return json({
            projectId,
            serviceStacks: [
              { id: serviceId, name: "codexworkspace", processes: [{ id: "create", status: "PENDING" }] },
            ],
          });
        }
        if (path === "/process/create") {
          order.push("create-process-polled");
          return json({ id: "create", projectId, clientId, status: "FINISHED" });
        }
        if (path === `/project/${projectId}`) {
          return json(ownedProject());
        }
        if (path === `/service-stack/${serviceId}/enable-subdomain-access`) {
          expect(init.method).toBe("PUT");
          order.push("subdomain-enable-requested");
          return json({ id: "enable", projectId, clientId, status: "PENDING" });
        }
        if (path === "/process/enable") {
          order.push("enable-process-polled");
          return json({ id: "enable", projectId, clientId, status: "FINISHED" });
        }
        if (path === `/service-stack/${serviceId}`) {
          serviceReads += 1;
          order.push(`service-read-${serviceReads}`);
          return json(
            workspaceService({
              subdomainAccess: serviceReads >= 3,
              ...(serviceReads >= 3
                ? { subdomainUrl: "https://codexworkspace-proof-8787.prg1.zerops.app" }
                : {}),
            }),
          );
        }
        if (url === "https://codexworkspace-proof-8787.prg1.zerops.app/health") {
          order.push("healthy");
          return json({ status: "ready" });
        }
        throw new Error(`Unexpected request ${String(init.method)} ${url}`);
      },
      sourcePusher: {
        push: async (input) => {
          await Promise.resolve();
          pushed.push(input);
          order.push("pushed");
        },
      },
      sleepFunction: () => Promise.resolve(),
      pollIntervalMs: 10,
    });

    const result = await client.provision({
      connectionId,
      ownershipHash,
      bridgePublicKeyBase64: "cHVibGljLWtleQ==",
      repositoryMcpUrl: "https://trialrun.aryankumar.dev/api/agent-tools/repository/mcp",
      onCreated: async (identity) => {
        await Promise.resolve();
        expect(identity).toEqual({ projectId, serviceId });
        order.push("persisted");
      },
    });

    expect(result).toEqual({
      projectId,
      serviceId,
      bridgeUrl: "https://codexworkspace-proof-8787.prg1.zerops.app",
    });
    expect(order).toEqual([
      "imported",
      "persisted",
      "create-process-polled",
      "service-read-1",
      "pushed",
      "subdomain-enable-requested",
      "enable-process-polled",
      "service-read-2",
      "service-read-3",
      "healthy",
    ]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ projectId, serviceId });
  });

  it("rejects a non-Zerops bridge URL returned by the post-enable service read", async () => {
    let serviceReads = 0;
    let pushed = false;
    const client = new ZeropsWorkspacePlatformClient({
      apiUrl: "https://api.app-prg1.zerops.io/api/rest/public",
      accessToken: "secret-zerops-token",
      clientId,
      sourceDirectory: await sourceDirectory(),
      fetchFunction: async (url, init) => {
        await Promise.resolve();
        const path = new URL(url).pathname.replace("/api/rest/public", "");
        if (path === `/project/${projectId}`) return json(ownedProject());
        if (path === `/service-stack/${serviceId}`) {
          serviceReads += 1;
          return json(
            workspaceService({
              subdomainAccess: serviceReads >= 2,
              ...(serviceReads >= 2 ? { subdomainUrl: "https://example.com" } : {}),
            }),
          );
        }
        if (path === `/service-stack/${serviceId}/enable-subdomain-access`) {
          expect(init.method).toBe("PUT");
          expect(pushed).toBe(true);
          return json({ id: "enable", projectId, clientId, status: "PENDING" });
        }
        if (path === "/process/enable") {
          return json({ id: "enable", projectId, clientId, status: "FINISHED" });
        }
        throw new Error(`Unexpected request ${String(init.method)} ${url}`);
      },
      sourcePusher: {
        push: async () => {
          await Promise.resolve();
          pushed = true;
        },
      },
      sleepFunction: () => Promise.resolve(),
      pollIntervalMs: 10,
    });

    await expect(
      client.provision({
        connectionId,
        ownershipHash,
        bridgePublicKeyBase64: "cHVibGljLWtleQ==",
        repositoryMcpUrl: "https://trialrun.aryankumar.dev/api/agent-tools/repository/mcp",
        existing: { projectId, serviceId },
        onCreated: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/invalid generated subdomain URL/);
  });

  it("refuses deletion before any DELETE when the exact ownership marker differs", async () => {
    let deleteCalls = 0;
    const client = new ZeropsWorkspacePlatformClient({
      apiUrl: "https://api.app-prg1.zerops.io/api/rest/public",
      accessToken: "secret-zerops-token",
      clientId,
      sourceDirectory: await sourceDirectory(),
      fetchFunction: async (_url, init) => {
        await Promise.resolve();
        if (init.method === "DELETE") deleteCalls += 1;
        return json({
          id: projectId,
          clientId,
          description: "another workspace",
          tagList: ["trialrun", "codex-workspace"],
          status: "ACTIVE",
          zeropsSubdomainHost: "proof.prg1.zerops.app",
        });
      },
      sourcePusher: { push: () => Promise.resolve() },
    });

    await expect(
      client.deleteExact({ connectionId, projectId, ownershipHash }),
    ).rejects.toThrow(/ownership does not match/);
    expect(deleteCalls).toBe(0);
  });

  it("rolls back the exact new project when immediate identity persistence fails", async () => {
    let projectPresent = true;
    let deleteCalls = 0;
    const client = new ZeropsWorkspacePlatformClient({
      apiUrl: "https://api.app-prg1.zerops.io/api/rest/public",
      accessToken: "secret-zerops-token",
      clientId,
      sourceDirectory: await sourceDirectory(),
      fetchFunction: async (url, init) => {
        await Promise.resolve();
        const path = new URL(url).pathname.replace("/api/rest/public", "");
        if (path === "/settings/import-project-yml-json-schema.json") {
          return json({
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          });
        }
        if (path === `/client/${clientId}/project/import`) {
          return json({
            projectId,
            serviceStacks: [{ id: serviceId, name: "codexworkspace", processes: [] }],
          });
        }
        if (path === `/project/${projectId}` && init.method === "GET") {
          return projectPresent
            ? json(ownedProject())
            : projectNotFound();
        }
        if (path === `/project/${projectId}` && init.method === "DELETE") {
          deleteCalls += 1;
          projectPresent = false;
          return json({ id: "delete", projectId, clientId, status: "PENDING" });
        }
        if (path === "/process/delete") {
          return json({ id: "delete", projectId, clientId, status: "FINISHED" });
        }
        throw new Error(`Unexpected request ${String(init.method)} ${url}`);
      },
      sourcePusher: { push: () => Promise.resolve() },
      sleepFunction: () => Promise.resolve(),
      pollIntervalMs: 10,
    });

    await expect(
      client.provision({
        connectionId,
        ownershipHash,
        bridgePublicKeyBase64: "cHVibGljLWtleQ==",
        repositoryMcpUrl: "https://trialrun.aryankumar.dev/api/agent-tools/repository/mcp",
        onCreated: () => Promise.reject(new Error("database unavailable")),
      }),
    ).rejects.toThrow("database unavailable");
    expect(deleteCalls).toBe(1);
    expect(projectPresent).toBe(false);
  });

  it("treats only HTTP 400 projectNotFound as deletion proof", async () => {
    let deleteCalls = 0;
    const client = new ZeropsWorkspacePlatformClient({
      apiUrl: "https://api.app-prg1.zerops.io/api/rest/public",
      accessToken: "secret-zerops-token",
      clientId,
      sourceDirectory: await sourceDirectory(),
      fetchFunction: async (_url, init) => {
        await Promise.resolve();
        if (init.method === "DELETE") deleteCalls += 1;
        return projectNotFound();
      },
      sourcePusher: { push: () => Promise.resolve() },
    });

    await expect(
      client.deleteExact({ connectionId, projectId, ownershipHash }),
    ).resolves.toMatchObject({
      provider: "zerops",
      projectId,
      result: "not_found",
    });
    expect(deleteCalls).toBe(0);

    const generic404Client = new ZeropsWorkspacePlatformClient({
      apiUrl: "https://api.app-prg1.zerops.io/api/rest/public",
      accessToken: "secret-zerops-token",
      clientId,
      sourceDirectory: await sourceDirectory(),
      fetchFunction: async () => {
        await Promise.resolve();
        return json({ error: { code: "notFound" } }, 404);
      },
      sourcePusher: { push: () => Promise.resolve() },
    });

    await expect(
      generic404Client.deleteExact({ connectionId, projectId, ownershipHash }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("rejects an oversized project-absence response before trusting its body", async () => {
    const client = new ZeropsWorkspacePlatformClient({
      apiUrl: "https://api.app-prg1.zerops.io/api/rest/public",
      accessToken: "secret-zerops-token",
      clientId,
      sourceDirectory: await sourceDirectory(),
      fetchFunction: async () => {
        await Promise.resolve();
        return json(
          {
            error: { code: "projectNotFound", message: "Project not found." },
            padding: "x".repeat(1_000_001),
          },
          400,
        );
      },
      sourcePusher: { push: () => Promise.resolve() },
    });

    await expect(
      client.deleteExact({ connectionId, projectId, ownershipHash }),
    ).rejects.toThrow(/oversized response/);
  });
});
