import "server-only";

import { createDatabase } from "@trialrun/db";

import { serverEnv } from "./env";

type DatabaseConnection = ReturnType<typeof createDatabase>;
const databaseGlobal = globalThis as typeof globalThis & {
  trialRunDatabaseConnection?: DatabaseConnection;
};

export function database(): DatabaseConnection["db"] {
  databaseGlobal.trialRunDatabaseConnection ??= createDatabase(serverEnv().DATABASE_URL, 10);
  return databaseGlobal.trialRunDatabaseConnection.db;
}
