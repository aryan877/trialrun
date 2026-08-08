import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCsrf: vi.fn(),
  assertSameOrigin: vi.fn(),
  currentAuth: vi.fn(),
  performWorkspaceAction: vi.fn(),
  readWorkspaceConnection: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  assertCsrf: mocks.assertCsrf,
  currentAuth: mocks.currentAuth,
}));
vi.mock("@/lib/http", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("./service", () => ({
  performWorkspaceAction: mocks.performWorkspaceAction,
  readWorkspaceConnection: mocks.readWorkspaceConnection,
  WorkspaceLifecycleConflictError: class WorkspaceLifecycleConflictError extends Error {},
}));

import { emptyWorkspaceConnectionMetadata } from "./contract";
import { GET, POST } from "./route";

const ownerId = "11111111-1111-4111-8111-111111111111";
const csrfToken = "csrf-token-long-enough-for-validation";
const auth = { user: { id: ownerId }, csrfToken, sessionToken: "session-token" };

function postRequest(body: object): Request {
  return new Request("http://localhost:3000/api/agent-connections/openai/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

describe("Codex workspace route boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentAuth.mockResolvedValue(auth);
    mocks.readWorkspaceConnection.mockResolvedValue(emptyWorkspaceConnectionMetadata());
    mocks.performWorkspaceAction.mockResolvedValue({
      ...emptyWorkspaceConnectionMetadata(),
      configured: true,
      status: "pending",
      operation: "provision",
      updatedAt: "2026-08-08T12:00:00.000Z",
    });
  });

  it("keeps owner metadata private and uncached", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.readWorkspaceConnection).toHaveBeenCalledWith(ownerId);

    mocks.currentAuth.mockResolvedValueOnce(null);
    const unauthorized = await GET();
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toContain("no-store");
  });

  it("checks origin, owner session, CSRF, and exact action before enqueueing", async () => {
    const request = postRequest({ intent: "connect", csrfToken });
    const response = await POST(request as Parameters<typeof POST>[0]);
    expect(response.status).toBe(200);
    expect(mocks.assertSameOrigin).toHaveBeenCalledWith(request);
    expect(mocks.assertCsrf).toHaveBeenCalledWith(auth, csrfToken);
    expect(mocks.performWorkspaceAction).toHaveBeenCalledWith(ownerId, {
      intent: "connect",
      csrfToken,
    });

    const invalid = await POST(
      postRequest({ intent: "connect", csrfToken, connectionId: "another-owner" }) as Parameters<
        typeof POST
      >[0],
    );
    expect(invalid.status).toBe(400);
  });

  it("rejects origin and CSRF failures without running lifecycle work", async () => {
    mocks.assertSameOrigin.mockImplementationOnce(() => {
      throw new Error("origin rejected");
    });
    expect(
      (await POST(postRequest({ intent: "connect", csrfToken }) as Parameters<typeof POST>[0]))
        .status,
    ).toBe(403);
    expect(mocks.performWorkspaceAction).not.toHaveBeenCalled();

    mocks.assertCsrf.mockImplementationOnce(() => {
      throw new Error("csrf rejected");
    });
    expect(
      (await POST(postRequest({ intent: "connect", csrfToken }) as Parameters<typeof POST>[0]))
        .status,
    ).toBe(403);
    expect(mocks.performWorkspaceAction).not.toHaveBeenCalled();
  });
});
