import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://trialrun:trialrun@127.0.0.1:55432/trialrun";
});

import { collectAvailableApplicationLogs, pullRequestEvidenceComment } from "./run-review";

afterEach(() => {
  vi.useRealTimers();
});

describe("review evidence preservation", () => {
  it("keeps the available side when the other application's logs fail", async () => {
    const secret = "test-secret-that-must-not-be-persisted";
    const sides: string[] = [];
    const logs = await collectAvailableApplicationLogs(
      {
        readLogs: (side) => {
          sides.push(side);
          return side === "base"
            ? Promise.reject(new Error(`log service rejected ${secret}`))
            : Promise.resolve("head application started");
        },
      },
      [secret],
    );

    expect(sides.sort()).toEqual(["base", "head"]);
    expect(logs.base).toContain("could not collect base application logs");
    expect(logs.base).not.toContain(secret);
    expect(logs.head).toBe("head application started");
  });

  it("bounds each side independently when a log reader never settles", async () => {
    vi.useFakeTimers();
    const logsPromise = collectAvailableApplicationLogs(
      {
        readLogs: (side) =>
          side === "base" ? new Promise<string>(() => undefined) : Promise.resolve("head logs"),
      },
      [],
    );

    await vi.advanceTimersByTimeAsync(35_000);
    await expect(logsPromise).resolves.toEqual({
      base: "[TrialRun could not collect base application logs: Application log collection exceeded its time limit.]",
      head: "head logs",
    });
  });
});

describe("pull request publication", () => {
  it("keeps the PR comment neutral and delegates status to the Check", () => {
    const comment = pullRequestEvidenceComment({
      detailsUrl: "https://trialrun.test/app/reviews/review-1",
      codeStrengthCount: 3,
      codeRiskCount: 2,
      evidence: {
        baseScreenshotUrl: "https://trialrun.test/proof/base.png",
        headScreenshotUrl: "https://trialrun.test/proof/head.png",
        baseRecordingUrl: "https://trialrun.test/proof/base.webm",
        headRecordingUrl: "https://trialrun.test/proof/head.webm",
      },
    });

    expect(comment).toContain("GitHub Check is the authoritative current status");
    expect(comment).toContain("3 strengths");
    expect(comment).toContain("2 code risks");
    expect(comment).toContain("![Base evidence]");
    expect(comment).toContain("Watch pull request recording");
    expect(comment).toContain("deleted before this comment was published");
    expect(comment).not.toMatch(/\b(?:pass|fail|inconclusive|cancelled)\b/i);
  });
});
