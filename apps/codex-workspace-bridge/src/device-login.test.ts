import { describe, expect, it } from "vitest";

import { deviceLoginInternals } from "./device-login";

describe("Codex device challenge parsing", () => {
  it("extracts only the official verification URI and one-time code", () => {
    const challenge = deviceLoginInternals.parseChallenge(
      "Open https://auth.openai.com/codex/device and enter ABCD-12345 (expires in 15 minutes)",
      Date.UTC(2026, 7, 8, 12),
    );
    expect(challenge).toEqual({
      status: "awaiting_auth",
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "ABCD-12345",
      expiresAt: "2026-08-08T12:15:00.000Z",
    });
  });

  it("does not accept another host or a malformed code", () => {
    expect(
      deviceLoginInternals.parseChallenge(
        "Open https://example.com/codex/device and enter ABC-123",
        Date.now(),
      ),
    ).toBeNull();
  });
});
