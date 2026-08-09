import { z } from "zod";

const projectNotFoundBodySchema = z
  .object({
    error: z
      .object({
        code: z.literal("projectNotFound"),
      })
      .passthrough(),
  })
  .passthrough();

export function isZeropsProjectAbsentResponse(status: number, body: unknown): boolean {
  return status === 400 && projectNotFoundBodySchema.safeParse(body).success;
}
