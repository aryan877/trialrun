import { describe, expect, it } from "vitest";

import type { ZeropsCleanupClaim, ZeropsCleanupFailure, ZeropsCleanupProof } from "@trialrun/db";

import {
  ZeropsCleanupClient,
  ZeropsCleanupWorker,
  zeropsCleanupOwnershipDescription,
  type ExactZeropsProjectDeleter,
  type ZeropsCleanupStore,
} from "./cleanup-worker";

const reviewId = "0c2ce8fd-f0a2-48b5-a0a2-aea3bf41f301";
const projectId = "project-123";
const clientId = "client-456";
const ownershipHash = "a".repeat(64);
const accessToken = "zerops-access-token-for-test";

function claim(overrides: Partial<ZeropsCleanupClaim> = {}): ZeropsCleanupClaim {
  return {
    reviewId,
    providerProjectId: projectId,
    providerOwnershipTokenHash: ownershipHash,
    claimantId: "runner-test:zerops-cleanup",
    attempt: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function responseQueue(responses: readonly Response[]): {
  readonly calls: { readonly url: string; readonly init: RequestInit }[];
  readonly fetchFunction: (url: string, init: RequestInit) => Promise<Response>;
} {
  const queue = [...responses];
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetchFunction: (url, init) => {
      calls.push({ url, init });
      const response = queue.shift();
      if (!response) throw new Error(`Unexpected Zerops request: ${init.method} ${url}`);
      return Promise.resolve(response);
    },
  };
}

function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: projectId,
    clientId,
    description: zeropsCleanupOwnershipDescription(reviewId, ownershipHash),
    status: "ACTIVE",
    ...overrides,
  };
}

function process(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "process-789",
    clientId,
    projectId,
    status,
    actionName: "delete",
    ...overrides,
  };
}

function cleanupClient(
  fetchFunction: (url: string, init: RequestInit) => Promise<Response>,
): ZeropsCleanupClient {
  return new ZeropsCleanupClient({
    apiUrl: "https://zerops.test/api/rest/public",
    accessToken,
    clientId,
    requestTimeoutMs: 1_000,
    operationTimeoutMs: 10_000,
    pollIntervalMs: 10,
    fetchFunction,
    sleepFunction: () => Promise.resolve(),
  });
}

describe("exact Zerops project deletion", () => {
  it("verifies ownership, deletes the exact ID, waits for its process, and polls to 404", async () => {
    const requests = responseQueue([
      jsonResponse(project()),
      jsonResponse(process("PENDING")),
      jsonResponse(process("FINISHED")),
      jsonResponse(project({ status: "DELETING" })),
      new Response(null, { status: 404 }),
    ]);

    const proof = await cleanupClient(requests.fetchFunction).deleteClaimedProject(claim());

    expect(proof).toMatchObject({ providerProjectId: projectId, deleted: true });
    expect(requests.calls.map(({ url, init }) => [init.method, new URL(url).pathname])).toEqual([
      ["GET", `/api/rest/public/project/${projectId}`],
      ["DELETE", `/api/rest/public/project/${projectId}`],
      ["GET", "/api/rest/public/process/process-789"],
      ["GET", `/api/rest/public/project/${projectId}`],
      ["GET", `/api/rest/public/project/${projectId}`],
    ]);
    expect(
      requests.calls.every(({ url }) => !url.includes("list") && !url.includes("search")),
    ).toBe(true);
    expect(new Headers(requests.calls[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${accessToken}`,
    );
  });

  it("records absence without issuing a mutation", async () => {
    const requests = responseQueue([new Response(null, { status: 404 })]);

    const proof = await cleanupClient(requests.fetchFunction).deleteClaimedProject(claim());

    expect(proof).toMatchObject({ providerProjectId: projectId, deleted: true });
    expect(requests.calls).toHaveLength(1);
    expect(requests.calls[0]?.init.method).toBe("GET");
  });

  it.each([
    ["project ID", { id: "other-project" }, "different project ID"],
    ["client ID", { clientId: "other-client" }, "different client"],
    ["description marker", { description: "TrialRun but not this review" }, "ownership marker"],
  ])("refuses a mismatched %s before DELETE", async (_label, override, message) => {
    const requests = responseQueue([jsonResponse(project(override))]);

    await expect(
      cleanupClient(requests.fetchFunction).deleteClaimedProject(claim()),
    ).rejects.toThrow(message);
    expect(requests.calls).toHaveLength(1);
    expect(requests.calls[0]?.init.method).toBe("GET");
  });

  it("requires the DB ownership hash before making any request", async () => {
    const requests = responseQueue([]);

    await expect(
      cleanupClient(requests.fetchFunction).deleteClaimedProject(
        claim({ providerOwnershipTokenHash: null }),
      ),
    ).rejects.toThrow();
    expect(requests.calls).toHaveLength(0);
  });

  it("refuses a process response that drifts from the exact deletion process ID", async () => {
    const requests = responseQueue([
      jsonResponse(project()),
      jsonResponse(process("PENDING")),
      jsonResponse(process("FINISHED", { id: "different-process" })),
    ]);

    await expect(
      cleanupClient(requests.fetchFunction).deleteClaimedProject(claim()),
    ).rejects.toThrow("different deletion process ID");
    expect(requests.calls.map(({ init }) => init.method)).toEqual(["GET", "DELETE", "GET"]);
  });
});

class FakeStore implements ZeropsCleanupStore {
  readonly claims: (ZeropsCleanupClaim | null)[];
  readonly completions: {
    readonly claim: ZeropsCleanupClaim;
    readonly proof: ZeropsCleanupProof;
  }[] = [];
  readonly failures: { readonly claim: ZeropsCleanupClaim; readonly error: string }[] = [];
  completionAccepted = true;
  failureResult: ZeropsCleanupFailure | null = { exhausted: false, retryAt: new Date() };

  constructor(claims: (ZeropsCleanupClaim | null)[]) {
    this.claims = claims;
  }

  claim(): Promise<ZeropsCleanupClaim | null> {
    return Promise.resolve(this.claims.shift() ?? null);
  }

  complete(claimValue: ZeropsCleanupClaim, proof: ZeropsCleanupProof): Promise<boolean> {
    this.completions.push({ claim: claimValue, proof });
    return Promise.resolve(this.completionAccepted);
  }

  fail(claimValue: ZeropsCleanupClaim, error: string): Promise<ZeropsCleanupFailure | null> {
    this.failures.push({ claim: claimValue, error });
    return Promise.resolve(this.failureResult);
  }
}

describe("periodic Zerops cleanup worker", () => {
  it("completes the DB lease only after exact deletion proof", async () => {
    const store = new FakeStore([claim()]);
    const proof: ZeropsCleanupProof = {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      providerProjectId: projectId,
      deleted: true,
      message: "Deleted.",
    };
    const deleter: ExactZeropsProjectDeleter = {
      deleteClaimedProject: () => Promise.resolve(proof),
    };
    const worker = new ZeropsCleanupWorker({
      store,
      deleter,
      claimantId: "runner-test:zerops-cleanup",
      leaseSeconds: 30,
    });

    expect(await worker.runOnce()).toBe("completed");
    expect(store.completions).toEqual([{ claim: claim(), proof }]);
    expect(store.failures).toEqual([]);
  });

  it("redacts the access token before persisting a bounded failure", async () => {
    const store = new FakeStore([claim()]);
    const deleter: ExactZeropsProjectDeleter = {
      deleteClaimedProject: () =>
        Promise.reject(new Error(`request failed with credential ${accessToken}`)),
    };
    const worker = new ZeropsCleanupWorker({
      store,
      deleter,
      claimantId: "runner-test:zerops-cleanup",
      leaseSeconds: 30,
      redactionValues: [accessToken],
    });

    expect(await worker.runOnce()).toBe("failed");
    expect(store.failures[0]?.error).toContain("[REDACTED]");
    expect(store.failures[0]?.error).not.toContain(accessToken);
  });

  it("stops its periodic loop when cancelled", async () => {
    const store = new FakeStore([null]);
    const controller = new AbortController();
    let sleeps = 0;
    const worker = new ZeropsCleanupWorker({
      store,
      deleter: { deleteClaimedProject: () => Promise.reject(new Error("unexpected")) },
      claimantId: "runner-test:zerops-cleanup",
      leaseSeconds: 30,
      pollIntervalMs: 100,
      sleepFunction: () => {
        sleeps += 1;
        const cancellation = new Error("Test cleanup worker cancellation.");
        controller.abort(cancellation);
        return Promise.reject(cancellation);
      },
    });

    await worker.run(controller.signal);

    expect(sleeps).toBe(1);
  });
});
