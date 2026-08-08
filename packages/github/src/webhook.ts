import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const signatureSchema = z.string().regex(/^sha256=[0-9a-f]{64}$/);
const deliveryIdSchema = z.string().uuid();
const eventNameSchema = z.string().regex(/^[a-z_]{1,80}$/);

export interface VerifiedWebhookHeaders {
  readonly deliveryId: string;
  readonly eventName: string;
}

export function verifyWebhook(input: {
  readonly rawBody: string;
  readonly secret: string;
  readonly signature: string;
  readonly deliveryId: string;
  readonly eventName: string;
}): VerifiedWebhookHeaders {
  const secret = z.string().min(20).max(1_000).parse(input.secret);
  const signature = signatureSchema.parse(input.signature);
  const expected = `sha256=${createHmac("sha256", secret).update(input.rawBody, "utf8").digest("hex")}`;
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("GitHub webhook signature is invalid.");
  }
  return {
    deliveryId: deliveryIdSchema.parse(input.deliveryId),
    eventName: eventNameSchema.parse(input.eventName),
  };
}
