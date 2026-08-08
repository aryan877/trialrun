import { and, eq } from "drizzle-orm";

import { agentConnections } from "@trialrun/db";

import { database } from "./db";

export async function connectedOpenAiConnectionId(userId: string): Promise<string> {
  const [connection] = await database()
    .select({ id: agentConnections.id })
    .from(agentConnections)
    .where(
      and(
        eq(agentConnections.userId, userId),
        eq(agentConnections.provider, "openai"),
        eq(agentConnections.status, "connected"),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new Error("Connect Codex before asking TrialRun to study a repository.");
  }
  return connection.id;
}
