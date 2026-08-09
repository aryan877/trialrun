import { z } from "zod";

const optionalRuntimeValue = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const runtimeSourceSchema = z.object({
  TRIALRUN_PROOF_BASE_SHA: optionalRuntimeValue,
  TRIALRUN_PROOF_BASE_WEBM_URL: optionalRuntimeValue,
  TRIALRUN_PROOF_HEAD_SHA: optionalRuntimeValue,
  TRIALRUN_PROOF_HEAD_WEBM_URL: optionalRuntimeValue,
  TRIALRUN_PROOF_GITHUB_CHECK_URL: optionalRuntimeValue,
  TRIALRUN_PROOF_REVIEW_URL: optionalRuntimeValue,
  TRIALRUN_PROOF_SUMMARY: optionalRuntimeValue,
  TRIALRUN_PROOF_TEARDOWN_SUMMARY: optionalRuntimeValue,
});

const safeRuntimeUrl = z
  .string()
  .max(2_048)
  .refine((value) => {
    if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" ||
          (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  }, "Expected an HTTPS URL, a localhost HTTP URL, or a site-relative path.");

const publicProofSchema = z.object({
  baseSha: z.string().regex(/^[0-9a-f]{40}$/i),
  baseWebmUrl: safeRuntimeUrl,
  headSha: z.string().regex(/^[0-9a-f]{40}$/i),
  headWebmUrl: safeRuntimeUrl,
  githubCheckUrl: safeRuntimeUrl,
  reviewUrl: safeRuntimeUrl,
  summary: z.string().min(8).max(160),
  teardownSummary: z.string().min(8).max(160),
});

export type PublicProof = z.infer<typeof publicProofSchema>;

export interface PublicRuntimeContent {
  readonly proof: PublicProof | null;
}

export function publicRuntimeContent(
  source: Readonly<Record<string, string | undefined>>,
): PublicRuntimeContent {
  const values = runtimeSourceSchema.parse(source);
  const proof = publicProofSchema.safeParse({
    baseSha: values.TRIALRUN_PROOF_BASE_SHA,
    baseWebmUrl: values.TRIALRUN_PROOF_BASE_WEBM_URL,
    headSha: values.TRIALRUN_PROOF_HEAD_SHA,
    headWebmUrl: values.TRIALRUN_PROOF_HEAD_WEBM_URL,
    githubCheckUrl: values.TRIALRUN_PROOF_GITHUB_CHECK_URL,
    reviewUrl: values.TRIALRUN_PROOF_REVIEW_URL,
    summary: values.TRIALRUN_PROOF_SUMMARY,
    teardownSummary: values.TRIALRUN_PROOF_TEARDOWN_SUMMARY,
  });

  return {
    proof: proof.success ? proof.data : null,
  };
}
