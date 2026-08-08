import "server-only";

import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { sessions, users, type User } from "@trialrun/db";
import {
  deriveCsrfToken,
  hashToken,
  normalizeEmail,
  randomToken,
  verifyCsrfToken,
} from "@trialrun/domain";

import { database } from "./db";
import { csrfKey, serverEnv } from "./env";

const sessionCookieName = "trialrun_session";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const passwordOptions = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;
const credentialsSchema = z.object({
  email: z.email().max(320).transform(normalizeEmail),
  password: z.string().min(12).max(128),
}).brand<"LoginAccountInput">();
const registrationSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(2).max(100),
}).brand<"RegisterAccountInput">();
const dummyHash = hash("TrialRun timing equalizer only", passwordOptions);
type FormValue = ReturnType<FormData["get"]>;

export type LoginAccountInput = z.infer<typeof credentialsSchema>;
export type RegisterAccountInput = z.infer<typeof registrationSchema>;

export function parseLoginAccountInput(input: {
  readonly email: FormValue;
  readonly password: FormValue;
}): LoginAccountInput {
  return credentialsSchema.parse(input);
}

export function parseRegisterAccountInput(input: {
  readonly displayName: FormValue;
  readonly email: FormValue;
  readonly password: FormValue;
}): RegisterAccountInput {
  return registrationSchema.parse(input);
}

export interface AuthContext {
  readonly user: User;
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly csrfToken: string;
}

async function replaceSession(userId: string): Promise<void> {
  const cookieStore = await cookies();
  const previous = cookieStore.get(sessionCookieName)?.value;
  if (previous) await database().delete(sessions).where(eq(sessions.tokenHash, hashToken(previous)));
  const token = randomToken();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await database().insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    secure:
      serverEnv().NODE_ENV === "production" || new URL(serverEnv().APP_URL).protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high",
  });
}

export async function registerAccount(credentials: RegisterAccountInput): Promise<User | null> {
  const passwordHash = await hash(credentials.password, passwordOptions);
  const [user] = await database()
    .insert(users)
    .values({
      email: credentials.email,
      passwordHash,
      displayName: credentials.displayName,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (!user) return null;
  await replaceSession(user.id);
  return user;
}

export async function loginAccount(credentials: LoginAccountInput): Promise<User | null> {
  const [user] = await database()
    .select()
    .from(users)
    .where(eq(users.email, credentials.email))
    .limit(1);
  const valid = await verify(user?.passwordHash ?? (await dummyHash), credentials.password);
  if (!user || !valid) return null;
  await replaceSession(user.id);
  return user;
}

export async function currentAuth(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;
  if (!sessionToken) return null;
  const [record] = await database()
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(sessionToken)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!record) {
    return null;
  }
  return {
    user: record.user,
    sessionId: record.sessionId,
    sessionToken,
    csrfToken: deriveCsrfToken(sessionToken, csrfKey()),
  };
}

export async function publicAuth(): Promise<AuthContext | null> {
  try {
    return await currentAuth();
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<AuthContext> {
  const auth = await currentAuth();
  if (!auth) throw new Error("Authentication required.");
  return auth;
}

export function assertCsrf(auth: AuthContext, suppliedToken: string | null | undefined): void {
  if (!suppliedToken || !verifyCsrfToken(auth.sessionToken, suppliedToken, csrfKey())) {
    throw new Error("The request CSRF token is invalid.");
  }
}

export async function logoutAccount(auth: AuthContext): Promise<void> {
  await database().delete(sessions).where(eq(sessions.id, auth.sessionId));
  (await cookies()).delete(sessionCookieName);
}
