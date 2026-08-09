import { describe, expect, it } from "vitest";

import { isReviewCancellationSignal, ReviewCancellationError } from "./review-cancellation";

describe("review cancellation signals", () => {
  it("distinguishes a user cancellation from runner failures and timeouts", () => {
    const requested = new AbortController();
    requested.abort(new ReviewCancellationError());
    expect(isReviewCancellationSignal(requested.signal)).toBe(true);

    const timedOut = new AbortController();
    timedOut.abort(new Error("Review exceeded the configured runner timeout."));
    expect(isReviewCancellationSignal(timedOut.signal)).toBe(false);
    expect(isReviewCancellationSignal()).toBe(false);
  });
});
