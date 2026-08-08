import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type TrialRunDatabase } from "./client";
import { webhookDeliveries } from "./schema";
import { claimWebhookDelivery, completeWebhookDelivery, failWebhookDelivery } from "./webhooks";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://trialrun:trialrun@127.0.0.1:55432/trialrun";

const connection = createDatabase(databaseUrl, 10);
const deliveryIds = new Set<string>();
let db: TrialRunDatabase;

function testDeliveryId(): string {
  const deliveryId = randomUUID();
  deliveryIds.add(deliveryId);
  return deliveryId;
}

beforeAll(() => {
  db = connection.db;
});

afterAll(async () => {
  if (deliveryIds.size > 0) {
    await db
      .delete(webhookDeliveries)
      .where(inArray(webhookDeliveries.deliveryId, [...deliveryIds]));
  }
  await connection.close();
});

describe("durable webhook delivery leases", () => {
  it("allows exactly one concurrent claimant for the same delivery", async () => {
    const deliveryId = testDeliveryId();
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        claimWebhookDelivery(db, {
          deliveryId,
          eventName: "pull_request",
          claimantId: `webhook-concurrent-${index}`,
          leaseSeconds: 30,
        }),
      ),
    );
    const winners = claims.filter((claim) => claim !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.attempt).toBe(1);
    const [stored] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(stored?.attempts).toBe(1);
    expect(stored?.lockedBy).toBe(winners[0]?.claimantId);
  });

  it("releases a failed delivery for a bounded retry", async () => {
    const deliveryId = testDeliveryId();
    const first = await claimWebhookDelivery(db, {
      deliveryId,
      eventName: "issue_comment",
      claimantId: "webhook-retry-a",
      leaseSeconds: 30,
    });
    if (!first) throw new Error("The first webhook claim was not acquired.");

    await failWebhookDelivery(db, first, "temporary processing failure");
    const second = await claimWebhookDelivery(db, {
      deliveryId,
      eventName: "issue_comment",
      claimantId: "webhook-retry-b",
      leaseSeconds: 30,
    });

    expect(second).toMatchObject({ attempt: 2, claimantId: "webhook-retry-b" });
    if (!second) throw new Error("The retry webhook claim was not acquired.");
    expect(await completeWebhookDelivery(db, second)).toBe(true);
    expect(
      await claimWebhookDelivery(db, {
        deliveryId,
        eventName: "issue_comment",
        claimantId: "webhook-retry-c",
        leaseSeconds: 30,
      }),
    ).toBeNull();
  });

  it("rejects a stale attempt when a claimant identity is reused", async () => {
    const deliveryId = testDeliveryId();
    const first = await claimWebhookDelivery(db, {
      deliveryId,
      eventName: "pull_request",
      claimantId: "stable-webhook-worker",
      leaseSeconds: 30,
    });
    if (!first) throw new Error("The first webhook claim was not acquired.");

    await db
      .update(webhookDeliveries)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    const replacement = await claimWebhookDelivery(db, {
      deliveryId,
      eventName: "pull_request",
      claimantId: "stable-webhook-worker",
      leaseSeconds: 30,
    });

    expect(replacement?.attempt).toBe(2);
    expect(await completeWebhookDelivery(db, first)).toBe(false);
    await failWebhookDelivery(db, first, "late failure from the stale attempt");
    const [stillClaimed] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(stillClaimed?.lockedBy).toBe("stable-webhook-worker");
    expect(stillClaimed?.lastError).toBeNull();
    if (!replacement) throw new Error("The replacement webhook claim was not acquired.");
    expect(await completeWebhookDelivery(db, replacement)).toBe(true);
  });

  it("stops retrying at the configured attempt cap", async () => {
    const deliveryId = testDeliveryId();
    for (const claimantId of ["webhook-cap-a", "webhook-cap-b"]) {
      const claim = await claimWebhookDelivery(db, {
        deliveryId,
        eventName: "pull_request",
        claimantId,
        leaseSeconds: 30,
        maxAttempts: 2,
      });
      if (!claim) throw new Error(`Webhook attempt for ${claimantId} was not acquired.`);
      await failWebhookDelivery(db, claim, "retryable failure");
    }

    expect(
      await claimWebhookDelivery(db, {
        deliveryId,
        eventName: "pull_request",
        claimantId: "webhook-cap-c",
        leaseSeconds: 30,
        maxAttempts: 2,
      }),
    ).toBeNull();
    const [stored] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(stored?.attempts).toBe(2);
  });

  it("never reinterprets one delivery ID as a different event", async () => {
    const deliveryId = testDeliveryId();
    const original = await claimWebhookDelivery(db, {
      deliveryId,
      eventName: "pull_request",
      claimantId: "webhook-event-original",
      leaseSeconds: 30,
    });
    if (!original) throw new Error("The original webhook claim was not acquired.");
    await failWebhookDelivery(db, original, "retry with the original event");

    expect(
      await claimWebhookDelivery(db, {
        deliveryId,
        eventName: "issue_comment",
        claimantId: "webhook-event-collision",
        leaseSeconds: 30,
      }),
    ).toBeNull();
    const retry = await claimWebhookDelivery(db, {
      deliveryId,
      eventName: "pull_request",
      claimantId: "webhook-event-retry",
      leaseSeconds: 30,
    });
    expect(retry?.attempt).toBe(2);
    const [stored] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(stored?.eventName).toBe("pull_request");
  });
});
