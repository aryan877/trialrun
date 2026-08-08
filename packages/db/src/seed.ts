import { eq } from "drizzle-orm";

import { normalizeEmail } from "@trialrun/domain";

import { createDatabase } from "./client";
import { users } from "./schema";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.SEED_USER_EMAIL;
const passwordHash = process.env.SEED_USER_PASSWORD_HASH;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}
if (!email || !passwordHash) {
  process.stdout.write("No seed user requested. Set SEED_USER_EMAIL and SEED_USER_PASSWORD_HASH.\n");
  process.exit(0);
}

const connection = createDatabase(databaseUrl, 1);
try {
  const normalized = normalizeEmail(email);
  const [existing] = await connection.db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!existing) {
    await connection.db.insert(users).values({
      email: normalized,
      displayName: normalized.split("@")[0] || "TrialRun user",
      passwordHash,
    });
  }
  process.stdout.write("Seed complete.\n");
} finally {
  await connection.close();
}
