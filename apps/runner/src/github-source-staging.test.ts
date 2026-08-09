import { describe, expect, it, vi } from "vitest";

import { RetryableGitHubSourceAccessError } from "@trialrun/executor";

import { stageGitHubSourceWithFreshToken } from "./github-source-staging";

describe("GitHub source staging", () => {
  it("mints a fresh token and retries a temporary repository visibility failure", async () => {
    const tokens = ["first-installation-token", "second-installation-token"];
    const issueToken = vi.fn(() => Promise.resolve(tokens.shift() ?? "unexpected-token"));
    const stage = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new RetryableGitHubSourceAccessError())
      .mockResolvedValueOnce("staged");
    const sleepFunction = vi.fn(() => Promise.resolve());

    await expect(
      stageGitHubSourceWithFreshToken({ issueToken, stage, sleepFunction }),
    ).resolves.toBe("staged");
    expect(issueToken).toHaveBeenCalledTimes(2);
    expect(stage.mock.calls).toEqual([["first-installation-token"], ["second-installation-token"]]);
    expect(sleepFunction).toHaveBeenCalledWith(2_000, undefined);
  });

  it("does not retry deterministic source failures", async () => {
    const issueToken = vi.fn(() => Promise.resolve("installation-token"));
    const stage = vi.fn(() =>
      Promise.reject(new Error("head checkout did not match its requested SHA")),
    );
    const sleepFunction = vi.fn(() => Promise.resolve());

    await expect(
      stageGitHubSourceWithFreshToken({ issueToken, stage, sleepFunction }),
    ).rejects.toThrow("head checkout did not match its requested SHA");
    expect(issueToken).toHaveBeenCalledOnce();
    expect(sleepFunction).not.toHaveBeenCalled();
  });

  it("stops after two bounded retries", async () => {
    const issueToken = vi.fn(() => Promise.resolve("fresh-installation-token"));
    const stage = vi.fn(() => Promise.reject(new RetryableGitHubSourceAccessError()));
    const sleepFunction = vi.fn(() => Promise.resolve());

    await expect(
      stageGitHubSourceWithFreshToken({ issueToken, stage, sleepFunction }),
    ).rejects.toThrow(RetryableGitHubSourceAccessError);
    expect(issueToken).toHaveBeenCalledTimes(3);
    expect(sleepFunction.mock.calls).toEqual([
      [2_000, undefined],
      [4_000, undefined],
    ]);
  });

  it("honors cancellation between attempts", async () => {
    const controller = new AbortController();
    const issueToken = vi.fn(() => Promise.resolve("installation-token"));
    const stage = vi.fn(() => Promise.reject(new RetryableGitHubSourceAccessError()));
    const sleepFunction = vi.fn(() => {
      controller.abort(new Error("review cancelled"));
      return Promise.resolve();
    });

    await expect(
      stageGitHubSourceWithFreshToken({
        issueToken,
        stage,
        signal: controller.signal,
        sleepFunction,
      }),
    ).rejects.toThrow("review cancelled");
    expect(issueToken).toHaveBeenCalledOnce();
    expect(stage).toHaveBeenCalledOnce();
  });
});
