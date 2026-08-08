import { describe, expect, it } from "vitest";

import type { Artifact } from "@trialrun/db";

import { pairBrowserRecordingArtifacts, pairScreenshotArtifacts } from "./review-evidence-pairing";

function artifact(input: {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly side: "base" | "head" | "review";
}): Artifact {
  return {
    id: input.id,
    reviewId: "00000000-0000-4000-8000-000000000000",
    side: input.side,
    kind: input.kind,
    storageKey: `00000000-0000-4000-8000-000000000000/${input.label}.webm`,
    mediaType: input.kind === "browser_recording" ? "video/webm" : "image/png",
    sha256: input.id.padEnd(64, "0").slice(0, 64),
    sizeBytes: 1_024,
    label: input.label,
    metadata: {},
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
  };
}

describe("review evidence pairing", () => {
  it("pairs persisted base and head recordings by their side-neutral label", () => {
    const base = artifact({
      id: "1",
      kind: "browser_recording",
      label: "base-browser-review",
      side: "base",
    });
    const head = artifact({
      id: "2",
      kind: "browser_recording",
      label: "head-browser-review",
      side: "head",
    });

    expect(pairBrowserRecordingArtifacts([base, head])).toEqual([
      { name: "browser-review", base, head },
    ]);
  });

  it("keeps an honestly partial recording pair and ignores unrelated artifacts", () => {
    const head = artifact({
      id: "3",
      kind: "browser_recording",
      label: "head-browser-review",
      side: "head",
    });
    const screenshot = artifact({
      id: "4",
      kind: "screenshot",
      label: "base-home",
      side: "base",
    });
    const reviewLedger = artifact({
      id: "5",
      kind: "browser_recording",
      label: "browser-review",
      side: "review",
    });

    expect(pairBrowserRecordingArtifacts([head, screenshot, reviewLedger])).toEqual([
      { name: "browser-review", head },
    ]);
    expect(pairScreenshotArtifacts([head, screenshot])).toEqual([
      { name: "home", base: screenshot },
    ]);
  });
});
