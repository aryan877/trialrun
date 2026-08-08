import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import type { TrialRunDatabase } from "./client";
import { webhookDeliveries } from "./schema";

export interface WebhookDeliveryClaim {
  readonly deliveryId: string;
  readonly claimantId: string;
  readonly attempt: number;
}

export async function claimWebhookDelivery(
  db: TrialRunDatabase,
  input: {
    readonly deliveryId: string;
    readonly eventName: string;
    readonly claimantId: string;
    readonly leaseSeconds?: number;
    readonly maxAttempts?: number;
  },
): Promise<WebhookDeliveryClaim | null> {
  const leaseSeconds = input.leaseSeconds ?? 300;
  const maxAttempts = input.maxAttempts ?? 8;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    throw new Error("Webhook lease must be between 30 and 900 seconds.");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("Webhook attempts must be between 1 and 20.");
  }

  await db
    .insert(webhookDeliveries)
    .values({ deliveryId: input.deliveryId, eventName: input.eventName })
    .onConflictDoNothing();

  const now = new Date();
  const [claimed] = await db
    .update(webhookDeliveries)
    .set({
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      lockedBy: input.claimantId,
      leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000),
      lastError: null,
    })
    .where(
      and(
        eq(webhookDeliveries.deliveryId, input.deliveryId),
        eq(webhookDeliveries.eventName, input.eventName),
        isNull(webhookDeliveries.processedAt),
        or(isNull(webhookDeliveries.leaseExpiresAt), lt(webhookDeliveries.leaseExpiresAt, now)),
        sql`${webhookDeliveries.attempts} < ${maxAttempts}`,
      ),
    )
    .returning({ attempt: webhookDeliveries.attempts });

  return claimed
    ? { deliveryId: input.deliveryId, claimantId: input.claimantId, attempt: claimed.attempt }
    : null;
}

export async function completeWebhookDelivery(
  db: TrialRunDatabase,
  claim: WebhookDeliveryClaim,
): Promise<boolean> {
  const [completed] = await db
    .update(webhookDeliveries)
    .set({ processedAt: new Date(), lockedBy: null, leaseExpiresAt: null, lastError: null })
    .where(
      and(
        eq(webhookDeliveries.deliveryId, claim.deliveryId),
        eq(webhookDeliveries.lockedBy, claim.claimantId),
        eq(webhookDeliveries.attempts, claim.attempt),
        isNull(webhookDeliveries.processedAt),
      ),
    )
    .returning({ deliveryId: webhookDeliveries.deliveryId });
  return Boolean(completed);
}

export async function failWebhookDelivery(
  db: TrialRunDatabase,
  claim: WebhookDeliveryClaim,
  error: string,
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ lockedBy: null, leaseExpiresAt: null, lastError: error.slice(0, 8_000) })
    .where(
      and(
        eq(webhookDeliveries.deliveryId, claim.deliveryId),
        eq(webhookDeliveries.lockedBy, claim.claimantId),
        eq(webhookDeliveries.attempts, claim.attempt),
        isNull(webhookDeliveries.processedAt),
      ),
    );
}
