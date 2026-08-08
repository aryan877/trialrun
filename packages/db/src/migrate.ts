import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase } from "./client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const connection = createDatabase(databaseUrl, 1);
try {
  await migrate(connection.db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  process.stdout.write("TrialRun migrations applied.\n");
} finally {
  await connection.close();
}
