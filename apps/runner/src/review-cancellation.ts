export class ReviewCancellationError extends Error {
  constructor() {
    super("Review cancellation was requested.");
    this.name = "ReviewCancellationError";
  }
}

export function isReviewCancellationSignal(signal?: AbortSignal): boolean {
  return signal?.aborted === true && signal.reason instanceof ReviewCancellationError;
}
