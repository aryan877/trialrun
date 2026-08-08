import { LiveBrowserSession, startLiveBrowserServer } from "@trialrun/executor";

import { loadCloudExecutorConfig } from "./config";

async function main(): Promise<void> {
  const config = loadCloudExecutorConfig();
  const session = await LiveBrowserSession.create({
    origins: config.origins,
    secrets: config.secrets,
  });
  const server = await startLiveBrowserServer({
    session,
    executionToken: config.executionToken,
    reviewId: config.reviewId,
    host: config.host,
    port: config.port,
  });
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await server.close();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  process.stdout.write(`TrialRun live executor listening on ${server.host}:${server.port}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup failure.";
  process.stderr.write(`TrialRun live executor failed to start: ${message}\n`);
  process.exitCode = 1;
});
