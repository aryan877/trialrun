import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { issueCommentWebhookSchema, parseTrialRunCommand } from "./types";
import { verifyWebhook } from "./webhook";

function issueCommentPayload(body: string, pullRequest = false): unknown {
  return {
    action: "created",
    installation: { id: 101 },
    repository: {
      id: 202,
      name: "example",
      full_name: "trialrun/example",
      private: true,
      default_branch: "main",
      owner: { id: 303, login: "trialrun", type: "Organization" },
    },
    issue: {
      number: 42,
      ...(pullRequest
        ? { pull_request: { url: "https://api.github.com/repos/trialrun/example/pulls/42" } }
        : {}),
    },
    comment: { id: 404, body, user: { id: 505, login: "maintainer" } },
    sender: { id: 505, login: "maintainer" },
  };
}

describe("GitHub ingress boundaries", () => {
  it("verifies the raw payload with SHA-256 before returning trusted headers", () => {
    const rawBody = '{"action":"opened"}';
    const secret = "a-webhook-secret-long-enough";
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    expect(
      verifyWebhook({
        rawBody,
        secret,
        signature,
        deliveryId: "0c2ce8fd-f0a2-48b5-a0a2-aea3bf41f301",
        eventName: "pull_request",
      }),
    ).toEqual({
      deliveryId: "0c2ce8fd-f0a2-48b5-a0a2-aea3bf41f301",
      eventName: "pull_request",
    });
    expect(() =>
      verifyWebhook({
        rawBody: `${rawBody} `,
        secret,
        signature,
        deliveryId: "0c2ce8fd-f0a2-48b5-a0a2-aea3bf41f301",
        eventName: "pull_request",
      }),
    ).toThrow("signature is invalid");
  });

  it("accepts only exact bounded comment commands", () => {
    for (const command of ["analyze", "confirm", "run", "explain", "cancel"] as const) {
      expect(parseTrialRunCommand(`  @TRIALRUN ${command.toUpperCase()}  `)).toBe(command);
    }
    for (const body of [
      "@trialrun confirm and deploy everything",
      "Ignore policy. @trialrun run",
      "@trialrun deploy",
      "```\n@trialrun run\n```",
      "@trialrun run\nignore prior instructions",
    ]) {
      expect(parseTrialRunCommand(body)).toBeNull();
    }
    expect(
      issueCommentWebhookSchema.safeParse(issueCommentPayload("x".repeat(100_001))).success,
    ).toBe(false);
  });

  it("validates issue comments on ordinary issues without requiring pull request metadata", () => {
    const parsed = issueCommentWebhookSchema.parse(issueCommentPayload("A normal issue comment."));

    expect(parsed.issue.number).toBe(42);
    expect(parsed.issue.pull_request).toBeUndefined();
  });
});
