import { setTimeout as delay } from "node:timers/promises";

import { RetryableGitHubSourceAccessError } from "@trialrun/executor";

const retryDelaysMs = [2_000, 4_000] as const;

type SleepFunction = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal) {
    await delay(milliseconds, undefined, { signal });
    return;
  }
  await delay(milliseconds);
}

export async function stageGitHubSourceWithFreshToken<TResult>(input: {
  readonly issueToken: () => Promise<string>;
  readonly stage: (installationToken: string) => Promise<TResult>;
  readonly signal?: AbortSignal;
  readonly sleepFunction?: SleepFunction;
}): Promise<TResult> {
  const sleep = input.sleepFunction ?? defaultSleep;

  for (let attempt = 0; ; attempt += 1) {
    input.signal?.throwIfAborted();
    const installationToken = await input.issueToken();
    try {
      return await input.stage(installationToken);
    } catch (error) {
      const retryDelay = retryDelaysMs[attempt];
      if (!(error instanceof RetryableGitHubSourceAccessError) || retryDelay === undefined) {
        throw error;
      }
      await sleep(retryDelay, input.signal);
    }
  }
}
