import { describe, expect, it } from "vitest";

import { canTransitionReview } from "./review";

describe("review lifecycle", () => {
  it("permits the durable execution path and keeps terminal states terminal", () => {
    expect(canTransitionReview("queued", "provisioning")).toBe(true);
    expect(canTransitionReview("running", "comparing")).toBe(true);
    expect(canTransitionReview("publishing", "tearing_down")).toBe(true);
    expect(canTransitionReview("tearing_down", "completed")).toBe(true);
    expect(canTransitionReview("completed", "running")).toBe(false);
    expect(canTransitionReview("inconclusive", "queued")).toBe(false);
    expect(canTransitionReview("cancelled", "running")).toBe(false);
  });
});
