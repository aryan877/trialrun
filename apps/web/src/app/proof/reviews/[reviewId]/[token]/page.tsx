import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle, GithubLogo, ShieldCheck, Trash } from "@phosphor-icons/react/ssr";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { artifacts, findings, repositories } from "@trialrun/db";
import { agentTerminalReportSchema } from "@trialrun/domain";

import {
  pairBrowserRecordingArtifacts,
  pairScreenshotArtifacts,
} from "@/components/review-evidence-pairing";
import { EvidenceVideo } from "@/components/evidence-video";
import { formatBytes } from "@/components/product-ui";
import { database } from "@/lib/db";
import { loadPublicProofReview } from "@/lib/public-proof";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Recorded pull request proof — TrialRun",
  description: "Immutable base-versus-PR browser evidence captured by TrialRun on Zerops.",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

const liveEvidenceMetadataSchema = z.object({
  assertionCount: z.number().int().nonnegative().optional(),
  apiResponseCount: z.number().int().nonnegative().optional(),
});

function artifactUrl(input: {
  readonly reviewId: string;
  readonly token: string;
  readonly artifactId: string;
}): string {
  return `/proof/reviews/${input.reviewId}/${input.token}/artifacts/${input.artifactId}`;
}

export default async function PublicReviewProofPage({
  params,
}: {
  readonly params: Promise<{ reviewId: string; token: string }>;
}) {
  const route = await params;
  const review = await loadPublicProofReview(route);
  if (!review) notFound();

  const [repository, artifactRows, findingRows] = await Promise.all([
    database()
      .select({ owner: repositories.owner, name: repositories.name })
      .from(repositories)
      .where(eq(repositories.id, review.repositoryId))
      .limit(1)
      .then(([row]) => row),
    database()
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.reviewId, review.id),
          inArray(artifacts.kind, ["browser_recording", "screenshot", "live_evidence"]),
        ),
      )
      .orderBy(asc(artifacts.createdAt)),
    database()
      .select()
      .from(findings)
      .where(eq(findings.reviewId, review.id))
      .orderBy(asc(findings.createdAt)),
  ]);
  if (!repository) notFound();

  const recording = pairBrowserRecordingArtifacts(artifactRows).find(
    ({ base, head }) => base?.mediaType === "video/webm" && head?.mediaType === "video/webm",
  );
  const screenshot = pairScreenshotArtifacts(artifactRows).find(
    ({ base, head }) => base?.mediaType === "image/png" && head?.mediaType === "image/png",
  );
  if (!recording?.base || !recording.head || !screenshot?.base || !screenshot.head) notFound();

  const baseVideoUrl = artifactUrl({
    reviewId: review.id,
    token: route.token,
    artifactId: recording.base.id,
  });
  const headVideoUrl = artifactUrl({
    reviewId: review.id,
    token: route.token,
    artifactId: recording.head.id,
  });
  const baseScreenshotUrl = artifactUrl({
    reviewId: review.id,
    token: route.token,
    artifactId: screenshot.base.id,
  });
  const headScreenshotUrl = artifactUrl({
    reviewId: review.id,
    token: route.token,
    artifactId: screenshot.head.id,
  });
  const liveMetadata = liveEvidenceMetadataSchema.safeParse(
    artifactRows.find(({ kind }) => kind === "live_evidence")?.metadata,
  );
  const terminalReport = agentTerminalReportSchema.safeParse(review.agentTerminalReport);
  const summary = terminalReport.success
    ? terminalReport.data.evidenceSummary
    : "Codex completed an evidence-backed review of the running pull request.";
  const checkUrl = review.checkRunId
    ? `https://github.com/${repository.owner}/${repository.name}/runs/${review.checkRunId}`
    : `https://github.com/${repository.owner}/${repository.name}/pull/${review.pullNumber}`;

  return (
    <main className="public-page min-h-dvh bg-[#fbfbf8] text-[#111111]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex h-[68px] max-w-[1280px] items-center justify-between px-5 sm:px-8">
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:outline-none"
            href="/"
          >
            <ArrowLeft aria-hidden="true" className="size-4" weight="bold" />
            trial<span className="text-[#2357ff]">/</span>run
          </Link>
          <a
            className="inline-flex items-center gap-2 text-sm font-semibold underline decoration-black/25 underline-offset-4 hover:decoration-black focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:outline-none"
            href={checkUrl}
            rel="noreferrer"
          >
            <GithubLogo aria-hidden="true" className="size-4" weight="fill" />
            GitHub Check
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-[#176b3a]">
              <CheckCircle aria-hidden="true" className="size-5" weight="fill" />
              Recorded on Zerops · exact project deleted
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.05em] text-balance sm:text-6xl">
              {review.verdict === "fail"
                ? "Codex found a blocking risk."
                : "Codex approved the change."}
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-black/62">{summary}</p>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-black/14 pt-5 text-xs lg:grid-cols-1">
            <div>
              <dt className="text-black/45">Base</dt>
              <dd className="mt-1 font-mono">{review.baseSha.slice(0, 12)}</dd>
            </div>
            <div>
              <dt className="text-black/45">Pull request</dt>
              <dd className="mt-1 font-mono">{review.headSha.slice(0, 12)}</dd>
            </div>
          </dl>
        </div>

        <section className="mt-12 overflow-hidden rounded-xl border border-black/12 bg-[#111114] text-white shadow-[0_26px_80px_rgba(0,0,0,0.18)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">Real Chrome recordings</h2>
            <p className="text-xs text-white/46">Native WebM · stored once · SHA-256 checked</p>
          </div>
          <div className="grid divide-y divide-white/10 md:grid-cols-2 md:divide-x md:divide-y-0">
            {[
              { label: "Base", artifact: recording.base, url: baseVideoUrl },
              { label: "Pull request", artifact: recording.head, url: headVideoUrl },
            ].map(({ label, artifact, url }) => (
              <figure className="min-w-0" key={label}>
                <figcaption className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                  <span className="font-semibold">{label}</span>
                  <span className="font-mono text-white/46">{formatBytes(artifact.sizeBytes)}</span>
                </figcaption>
                <EvidenceVideo
                  className="aspect-[8/5] w-full bg-black object-contain"
                  label={`${label} Chrome recording`}
                  src={url}
                />
                <p
                  className="truncate border-t border-white/10 px-4 py-3 font-mono text-[10px] text-white/42"
                  title={artifact.sha256}
                >
                  SHA-256 {artifact.sha256}
                </p>
              </figure>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#2357ff]">Recorded browser state</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                Base and pull request screenshots
              </h2>
            </div>
            <p className="hidden text-xs text-black/45 sm:block">Checkpoint: {screenshot.name}</p>
          </div>
          <div className="mt-5 grid overflow-hidden rounded-xl border border-black/12 bg-white md:grid-cols-2 md:divide-x md:divide-black/12">
            {[
              { label: "Base", artifact: screenshot.base, url: baseScreenshotUrl },
              { label: "Pull request", artifact: screenshot.head, url: headScreenshotUrl },
            ].map(({ label, artifact, url }) => (
              <figure className="min-w-0" key={label}>
                <figcaption className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3 text-xs">
                  <span className="font-semibold">{label}</span>
                  <span className="font-mono text-black/42">{formatBytes(artifact.sizeBytes)}</span>
                </figcaption>
                <Image
                  alt={`${label} application at the recorded ${screenshot.name} checkpoint`}
                  className="h-auto w-full bg-[#f4f4f1]"
                  height={900}
                  src={url}
                  unoptimized
                  width={1440}
                />
              </figure>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-3">
          <article className="rounded-lg border border-black/12 bg-white p-5">
            <ShieldCheck aria-hidden="true" className="size-6 text-[#2357ff]" weight="duotone" />
            <h2 className="mt-5 text-lg font-semibold">Code and behavior</h2>
            <p className="mt-2 text-sm leading-6 text-black/58">
              Codex read the diff, investigated both live apps, and produced{" "}
              {liveMetadata.success ? (liveMetadata.data.assertionCount ?? 0) : 0} recorded
              assertions
              {liveMetadata.success && liveMetadata.data.apiResponseCount
                ? ` plus ${liveMetadata.data.apiResponseCount} live API responses`
                : ""}
              .
            </p>
          </article>
          <article className="rounded-lg border border-black/12 bg-white p-5">
            <GithubLogo aria-hidden="true" className="size-6" weight="fill" />
            <h2 className="mt-5 text-lg font-semibold">GitHub got the result</h2>
            <p className="mt-2 text-sm leading-6 text-black/58">
              The Check is the authoritative status. This page is its read-only proof trail, not a
              second verdict.
            </p>
          </article>
          <article className="rounded-lg border border-black/12 bg-white p-5">
            <Trash aria-hidden="true" className="size-6 text-[#d13c36]" weight="duotone" />
            <h2 className="mt-5 text-lg font-semibold">Nothing left running</h2>
            <p className="mt-2 text-sm leading-6 text-black/58">
              {z.object({ message: z.string() }).safeParse(review.teardownProof).data?.message ??
                "TrialRun confirmed the exact disposable Zerops project is absent."}
            </p>
          </article>
        </section>

        {findingRows.length > 0 ? (
          <section className="mt-12 border-t border-black/14 pt-10">
            <h2 className="text-3xl font-semibold tracking-[-0.04em]">What the run found</h2>
            <div className="mt-5 divide-y divide-black/12 border-y border-black/12">
              {findingRows.slice(0, 4).map((finding) => (
                <article
                  className="grid gap-2 py-5 sm:grid-cols-[220px_1fr] sm:gap-8"
                  key={finding.id}
                >
                  <h3 className="font-semibold">{finding.title}</h3>
                  <p className="text-sm leading-6 text-black/60">{finding.summary}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <p className="mt-12 border-t border-black/10 pt-5 text-xs leading-5 text-black/42">
          This private proof link reveals only these screenshots and browser recordings. It does not
          reveal source code, application logs, API responses, credentials, or the customer&apos;s
          Codex login.
        </p>
      </div>
    </main>
  );
}
