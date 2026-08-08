import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  OctagonAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import {
  artifacts,
  findings,
  githubInstallations,
  jobs,
  repositories,
  repositoryRecipes,
  reviewEvents,
  reviews,
} from "@trialrun/db";

import { productAuth } from "@/components/product-auth";
import {
  ArtifactLedger,
  BrowserRecordingEvidence,
  MatchedEvidence,
} from "@/components/review-evidence";
import {
  pairBrowserRecordingArtifacts,
  pairScreenshotArtifacts,
} from "@/components/review-evidence-pairing";
import {
  Definition,
  EmptyState,
  formatTimestamp,
  Notice,
  PageHeader,
  SectionHeading,
} from "@/components/product-ui";
import { ReviewPhaseRail, ReviewStatusBadge, StateBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { database } from "@/lib/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function eventCursor(query: Record<string, string | string[] | undefined>): number | null {
  const raw = firstValue(query.beforeEvent);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    result.push(entry);
  }
  return result;
}

function eventFacts(payload: Readonly<Record<string, unknown>>): readonly {
  readonly label: string;
  readonly value: string;
}[] {
  const facts: { label: string; value: string }[] = [];
  const fields = [
    ["providerProjectId", "Project"],
    ["deleted", "Deleted"],
    ["completedAt", "Completed"],
    ["stepCount", "Steps"],
    ["findingCount", "Findings"],
    ["goalCount", "Goals"],
    ["maxToolCalls", "Tool budget"],
    ["maxDurationSeconds", "Time budget (seconds)"],
    ["runtimeFindingCount", "Runtime findings"],
    ["codeRiskCount", "Code risks"],
    ["codeStrengthCount", "Code strengths"],
    ["threadId", "Codex thread"],
    ["jobId", "Job"],
  ] as const;
  for (const [key, label] of fields) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      facts.push({ label, value: String(value) });
    }
  }
  const secretNames = stringList(payload.requiredSecretNames);
  if (secretNames) {
    facts.push({
      label: "Required secret names",
      value: secretNames.length ? secretNames.join(", ") : "None",
    });
  }
  return facts;
}

function proofString(proof: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = proof?.[key];
  return typeof value === "string" ? value : null;
}

function CommitSide({
  side,
  sha,
  url,
  removed,
}: {
  readonly side: "base" | "head";
  readonly sha: string;
  readonly url: string | null;
  readonly removed: boolean;
}) {
  const safeUrl = safeHttpUrl(url);
  return (
    <article className="min-w-0 bg-black/15 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.08em] uppercase">
          {side === "base" ? "Base commit" : "Pull request commit"}
        </p>
        <GitCommitHorizontal
          aria-hidden="true"
          className={side === "base" ? "size-4 text-signal-info" : "size-4 text-signal-running"}
        />
      </div>
      <code className="mt-8 block break-all font-mono text-sm leading-6">{sha}</code>
      <div className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        {removed ? (
          <span className="inline-flex items-center gap-1.5">
            <Trash2 aria-hidden="true" className="size-3.5" />
            Disposable environment removed
          </span>
        ) : safeUrl ? (
          <a
            className="inline-flex items-center gap-1.5 text-signal-info hover:underline"
            href={safeUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open active environment
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : (
          <span>Environment URL not recorded</span>
        )}
      </div>
    </article>
  );
}

export default async function ReviewDetail({
  params,
  searchParams,
}: {
  readonly params: Promise<{ reviewId: string }>;
  readonly searchParams: SearchParams;
}) {
  const [{ reviewId: rawReviewId }, auth, query] = await Promise.all([
    params,
    productAuth(),
    searchParams,
  ]);
  if (!auth) redirect("/login?auth=required");
  const parsedId = z.string().uuid().safeParse(rawReviewId);
  if (!parsedId.success) notFound();

  const db = database();
  const [owned] = await db
    .select({
      review: reviews,
      repository: repositories,
      installation: githubInstallations,
      recipe: repositoryRecipes,
    })
    .from(reviews)
    .innerJoin(repositories, eq(reviews.repositoryId, repositories.id))
    .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
    .innerJoin(repositoryRecipes, eq(reviews.recipeId, repositoryRecipes.id))
    .where(
      and(
        eq(reviews.id, parsedId.data),
        eq(reviews.ownerUserId, auth.user.id),
        eq(githubInstallations.ownerUserId, auth.user.id),
        eq(repositoryRecipes.repositoryId, repositories.id),
      ),
    )
    .limit(1);
  if (!owned) notFound();

  const cursor = eventCursor(query);
  const eventCondition = cursor
    ? and(eq(reviewEvents.reviewId, owned.review.id), lt(reviewEvents.id, cursor))
    : eq(reviewEvents.reviewId, owned.review.id);
  const [eventRows, findingRows, artifactRows, jobRows] = await Promise.all([
    db.select().from(reviewEvents).where(eventCondition).orderBy(desc(reviewEvents.id)).limit(101),
    db
      .select()
      .from(findings)
      .where(eq(findings.reviewId, owned.review.id))
      .orderBy(asc(findings.firstDivergentStep), asc(findings.createdAt)),
    db
      .select()
      .from(artifacts)
      .where(eq(artifacts.reviewId, owned.review.id))
      .orderBy(asc(artifacts.createdAt)),
    db
      .select()
      .from(jobs)
      .where(eq(jobs.reviewId, owned.review.id))
      .orderBy(desc(jobs.createdAt))
      .limit(1),
  ]);

  const visibleEventsDescending = eventRows.slice(0, 100);
  const visibleEvents = [...visibleEventsDescending].reverse();
  const hasOlderEvents = eventRows.length > 100;
  const nextEventCursor = visibleEventsDescending.at(-1)?.id;
  const screenshotPairs = pairScreenshotArtifacts(artifactRows);
  const recordingPairs = pairBrowserRecordingArtifacts(artifactRows);
  const liveEvidenceSealed = artifactRows.some((artifact) => artifact.kind === "live_evidence");
  const job = jobRows[0];
  const proof = owned.review.teardownProof;
  const proofDeleted = proof?.deleted === true;
  const teardownProven = Boolean(owned.review.teardownCompletedAt && proofDeleted);
  const teardownFailed = Boolean(
    owned.review.teardownLastError || (proof && proof.deleted === false),
  );
  const teardownMessage = proofString(proof, "message") ?? owned.review.teardownLastError;
  const teardownProject = proofString(proof, "providerProjectId") ?? owned.review.providerProjectId;
  const teardownStarted =
    proofString(proof, "startedAt") ?? owned.review.teardownStartedAt?.toISOString() ?? null;
  const teardownCompleted =
    proofString(proof, "completedAt") ?? owned.review.teardownCompletedAt?.toISOString() ?? null;
  const terminal = ["completed", "inconclusive", "cancelled"].includes(owned.review.status);
  const githubPullUrl = `https://github.com/${encodeURIComponent(owned.repository.owner)}/${encodeURIComponent(owned.repository.name)}/pull/${owned.review.pullNumber}`;

  return (
    <>
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <Button asChild className="h-9 rounded-[2px]" variant="ghost">
              <Link href={`/app/repositories/${owned.repository.id}`}>
                <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                Repository
              </Link>
            </Button>
            <Button asChild className="h-9 rounded-[2px]" variant="outline">
              <a href={githubPullUrl} rel="noreferrer" target="_blank">
                <GitPullRequest aria-hidden="true" data-icon="inline-start" />
                PR #{owned.review.pullNumber}
              </a>
            </Button>
          </div>
        }
        description={
          <span>
            {owned.repository.owner}/{owned.repository.name} · recipe v{owned.recipe.version} ·{" "}
            {owned.review.provider === "local" ? "Local execution" : "Zerops execution"}
          </span>
        }
        eyebrow={`Review ${owned.review.id.slice(0, 8)}`}
        title={owned.review.title}
      />

      <div className="space-y-12 px-4 py-6 sm:py-8">
        <section className="grid overflow-hidden rounded-[4px] border border-border lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="border-b border-border p-4 sm:p-5 lg:border-r lg:border-b-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <ReviewStatusBadge status={owned.review.status} verdict={owned.review.verdict} />
                <h2 className="mt-4 text-xl leading-7 font-medium tracking-[-0.025em]">
                  {owned.review.verdict
                    ? owned.review.verdict === "pass"
                      ? "Base and pull request matched"
                      : owned.review.verdict === "fail"
                        ? "Behavioral divergence reproduced"
                        : "The evidence was inconclusive"
                    : "Review execution in progress"}
                </h2>
              </div>
              <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                {owned.review.provider}
              </span>
            </div>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">
              {owned.review.statusMessage}
            </p>
            <div className="mt-5 overflow-x-auto pb-1">
              <ReviewPhaseRail status={owned.review.status} />
            </div>
          </div>
          <dl className="p-4">
            <Definition term="Queued">{formatTimestamp(owned.review.createdAt)}</Definition>
            <Definition term="Started">{formatTimestamp(owned.review.startedAt)}</Definition>
            <Definition term="Completed">{formatTimestamp(owned.review.completedAt)}</Definition>
            <Definition term="GitHub check">
              {owned.review.checkRunId ? `#${owned.review.checkRunId}` : "Not created"}
            </Definition>
            <Definition term="Runner heartbeat">
              {job?.status === "running" && job.leaseExpiresAt
                ? `Lease active until ${formatTimestamp(job.leaseExpiresAt)}`
                : job
                  ? `${job.status}; updated ${formatTimestamp(job.updatedAt)}`
                  : "No durable job record"}
            </Definition>
          </dl>
        </section>

        <section className="space-y-4" aria-labelledby="commits">
          <SectionHeading
            description="These are the exact immutable SHAs recorded when the review was queued and re-verified against GitHub before execution."
            id="commits"
            title="Matched commit evidence"
          />
          <div className="grid overflow-hidden rounded-[4px] border border-border divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <CommitSide
              removed={teardownProven}
              sha={owned.review.baseSha}
              side="base"
              url={owned.review.baseUrl}
            />
            <CommitSide
              removed={teardownProven}
              sha={owned.review.headSha}
              side="head"
              url={owned.review.headUrl}
            />
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="mission">
          <SectionHeading
            description="Codex receives goals, questions, narrow tools, and hard budgets—not a prerecorded click list. It inspects the change and adapts against both running commits."
            id="mission"
            title="Live Codex mission"
          />
          {owned.review.agentMission ? (
            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="panel-surface p-4">
                <div className="flex items-center gap-2">
                  <ListChecks aria-hidden="true" className="size-4 text-signal-info" />
                  <h3 className="text-sm font-medium">{owned.review.agentMission.title}</h3>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  One context-rich Codex thread reads the exact base/head snapshots, investigates
                  the live apps, and hands recorded evidence to an independent oracle.
                </p>
                <dl className="mt-3">
                  <Definition term="Codex thread" mono>
                    {owned.review.agentThreadId ?? "Starts after both apps are ready"}
                  </Definition>
                  <Definition term="Tool calls">
                    {owned.review.agentRunMetrics
                      ? `${owned.review.agentRunMetrics.toolCalls} / ${owned.review.agentMission.budgets.maxToolCalls}`
                      : `Up to ${owned.review.agentMission.budgets.maxToolCalls}`}
                  </Definition>
                  <Definition term="Time limit">
                    {Math.round(owned.review.agentMission.budgets.maxDurationSeconds / 60)} minutes
                  </Definition>
                  <Definition term="Checkpoint limit">
                    {owned.review.agentMission.budgets.maxCheckpoints}
                  </Definition>
                  <Definition term="Allowed test-secret names">
                    {owned.review.agentMission.allowedSecretNames.length
                      ? owned.review.agentMission.allowedSecretNames.join(", ")
                      : "None"}
                  </Definition>
                  {owned.review.agentRunMetrics ? (
                    <Definition term="Tokens">
                      {owned.review.agentRunMetrics.usage.input_tokens.toLocaleString()} in ·{" "}
                      {owned.review.agentRunMetrics.usage.output_tokens.toLocaleString()} out
                    </Definition>
                  ) : null}
                </dl>
              </div>
              <div className="overflow-hidden rounded-[4px] border border-border">
                <ol>
                {owned.review.agentMission.goals.map((goal, index) => (
                  <li
                    className="grid grid-cols-[40px_minmax(0,1fr)] border-b border-border last:border-b-0"
                    key={goal.id}
                  >
                    <span className="flex items-center justify-center border-r border-border font-mono text-[10px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="px-3 py-3">
                      <p className="text-[10px] font-semibold tracking-[0.08em] text-signal-info uppercase">
                        {goal.kind.replaceAll("_", " ")} · {goal.priority}
                      </p>
                      <p className="mt-1 text-sm leading-5">{goal.objective}</p>
                    </div>
                  </li>
                ))}
                </ol>
                {owned.review.agentTerminalReport ? (
                  <div className="border-t border-border bg-black/10 p-4">
                    <p className="text-[10px] font-semibold tracking-[0.08em] text-signal-running uppercase">
                      Validated agent handoff · {owned.review.agentTerminalReport.termination.replaceAll("_", " ")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {owned.review.agentTerminalReport.evidenceSummary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                      <span>{owned.review.agentTerminalReport.evidenceIds.length} cited evidence IDs</span>
                      <span>{owned.review.agentTerminalReport.codeStrengths.length} code strengths</span>
                      <span>{owned.review.agentTerminalReport.codeRiskFindings.length} code risks</span>
                    </div>
                    {owned.review.agentTerminalReport.limitations.length ? (
                      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                        {owned.review.agentTerminalReport.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState
              description="The runner persists the mission after both immutable applications pass readiness checks. Codex then chooses its next action from live observations."
              title="Live mission has not started"
            />
          )}
        </section>

        <section className="space-y-4" aria-labelledby="browser-recordings">
          <SectionHeading
            description="The pull request recording is the primary behavior proof. Its matching base recording sits beside it on wide screens and below it on smaller screens. Both stream from the existing owner-scoped artifact route."
            id="browser-recordings"
            title="Recorded browser proof"
          />
          <BrowserRecordingEvidence evidenceSealed={liveEvidenceSealed} pairs={recordingPairs} />
        </section>

        <section className="space-y-4" aria-labelledby="matched-captures">
          <SectionHeading
            description="Checkpoint rows are paired by their recorded base and pull request labels. SHA-256 hashes identify the exact persisted files."
            id="matched-captures"
            title="Base / pull request captures"
          />
          <MatchedEvidence pairs={screenshotPairs} />
        </section>

        <section className="space-y-4" aria-labelledby="findings">
          <SectionHeading
            description="Runtime regressions come only from deterministic matched evidence. Code risks carry verified file/line citations and remain visibly unproven unless a base/head reproduction supports them."
            id="findings"
            title="Findings"
          />
          {findingRows.length === 0 ? (
            <EmptyState
              description={
                owned.review.verdict === "pass"
                  ? "The pull request satisfied every recorded assertion that passed on the base commit."
                  : owned.review.verdict
                    ? "No structured finding rows were persisted for this verdict. Review the event timeline for the recorded cause."
                    : "Findings are persisted after both sides finish and deterministic comparison runs."
              }
              title={
                owned.review.verdict === "pass"
                  ? "No behavioral regression found"
                  : "No findings recorded"
              }
            />
          ) : (
            <ul className="space-y-3">
              {findingRows.map((finding) => (
                <li className="panel-surface p-4" key={finding.id}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <StateBadge
                        icon={finding.severity === "blocking" ? OctagonAlert : TriangleAlert}
                        tone={finding.severity === "blocking" ? "failure" : "warning"}
                      >
                        {finding.severity}
                      </StateBadge>
                      <h3 className="mt-3 text-base leading-6 font-medium">{finding.title}</h3>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {finding.firstDivergentStep === null
                        ? finding.kind.startsWith("code_risk_")
                          ? "Cited code risk"
                          : "Matched runtime evidence"
                        : `First divergence: step ${finding.firstDivergentStep + 1}`}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.summary}</p>
                  {Object.keys(finding.evidence).length > 0 ? (
                    <details className="mt-3 border-t border-border pt-3 text-[11px] leading-4 text-muted-foreground">
                      <summary className="w-fit rounded-[2px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        Structured evidence ({Object.keys(finding.evidence).sort().join(", ")})
                      </summary>
                      <pre className="mt-2 max-h-80 overflow-auto rounded-[2px] bg-black/20 p-3 font-mono text-[10px] leading-4 text-foreground">
                        {JSON.stringify(finding.evidence, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4" aria-labelledby="artifacts">
          <SectionHeading
            description="The durable artifact ledger records storage identity, side, size, media kind, and integrity hash."
            id="artifacts"
            title="Artifact ledger"
          />
          <ArtifactLedger artifacts={artifactRows} />
        </section>

        <section className="space-y-4" aria-labelledby="teardown">
          <SectionHeading
            description="A pass is not complete until deletion of the exact review environment is positively recorded."
            id="teardown"
            title="Teardown proof"
          />
          <div className="grid overflow-hidden rounded-[4px] border border-border lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="border-b border-border p-4 sm:p-5 lg:border-r lg:border-b-0">
              <div className="flex items-start gap-3">
                {teardownProven ? (
                  <ShieldCheck aria-hidden="true" className="size-6 shrink-0 text-signal-running" />
                ) : teardownFailed ? (
                  <OctagonAlert aria-hidden="true" className="size-6 shrink-0 text-destructive" />
                ) : (
                  <Clock3 aria-hidden="true" className="size-6 shrink-0 text-signal-warning" />
                )}
                <div>
                  <h3 className="text-base leading-6 font-medium">
                    {teardownProven
                      ? "Disposable environment deletion confirmed"
                      : teardownFailed
                        ? "Environment deletion is not proven"
                        : terminal
                          ? "Terminal review without deletion proof"
                          : "Teardown has not completed"}
                  </h3>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {teardownMessage ??
                      (teardownProven
                        ? "The provider reported that the exact persisted project ID was deleted."
                        : "TrialRun is waiting for a provider deletion record.")}
                  </p>
                </div>
              </div>
              {terminal && !teardownProven ? (
                <div className="mt-4">
                  <Notice tone="warning">
                    This review must remain inconclusive unless cleanup can be reconciled and
                    positively proven.
                  </Notice>
                </div>
              ) : null}
            </div>
            <dl className="p-4">
              <Definition term="Provider project" mono>
                {teardownProject ?? "Not recorded"}
              </Definition>
              <Definition term="Deletion started">{formatTimestamp(teardownStarted)}</Definition>
              <Definition term="Deletion completed">
                {formatTimestamp(teardownCompleted)}
              </Definition>
              <Definition term="Attempts">{owned.review.teardownAttempts}</Definition>
              <Definition term="Deleted">
                {teardownProven ? (
                  <span className="inline-flex items-center gap-1.5 text-signal-running">
                    <Check aria-hidden="true" className="size-3.5" /> Yes
                  </span>
                ) : (
                  <span className="text-signal-warning">Not proven</span>
                )}
              </Definition>
            </dl>
          </div>
        </section>

        <section className="space-y-4 pb-8" aria-labelledby="events-heading" id="events">
          <SectionHeading
            description="Append-only review events, shown oldest to newest within this cursor page."
            id="events-heading"
            title="Event timeline"
          />
          {visibleEvents.length === 0 ? (
            <EmptyState
              actionLabel={cursor ? "Back to newest events" : undefined}
              description={
                cursor
                  ? "There are no events before this cursor."
                  : "The runner has not appended an event for this review yet."
              }
              href={cursor ? `/app/reviews/${owned.review.id}#events` : undefined}
              title={cursor ? "Start of event history" : "No review events"}
            />
          ) : (
            <div>
              <ol className="overflow-hidden rounded-[4px] border border-border">
                {visibleEvents.map((event) => {
                  const facts = eventFacts(event.payload);
                  return (
                    <li
                      className="grid border-b border-border last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]"
                      key={event.id}
                    >
                      <div className="border-b border-border bg-black/10 px-3 py-3 sm:border-r sm:border-b-0">
                        <p className="font-mono text-[10px] text-signal-info">{event.type}</p>
                        <time
                          className="mt-1 block text-[10px] leading-4 text-muted-foreground"
                          dateTime={event.createdAt.toISOString()}
                        >
                          {formatTimestamp(event.createdAt)}
                        </time>
                      </div>
                      <div className="px-3 py-3">
                        <p className="text-sm leading-5">{event.message}</p>
                        {facts.length > 0 ? (
                          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                            {facts.map((fact) => (
                              <div
                                className="flex min-w-0 gap-1.5 text-[10px] leading-4"
                                key={fact.label}
                              >
                                <dt className="text-muted-foreground">{fact.label}</dt>
                                <dd className="max-w-80 truncate font-mono" title={fact.value}>
                                  {fact.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3 flex items-center justify-between gap-3">
                {cursor ? (
                  <Button asChild className="rounded-[2px]" size="sm" variant="ghost">
                    <Link href={`/app/reviews/${owned.review.id}#events`}>
                      Back to newest events
                    </Link>
                  </Button>
                ) : (
                  <span />
                )}
                {hasOlderEvents && nextEventCursor ? (
                  <Button asChild className="rounded-[2px]" size="sm" variant="outline">
                    <Link
                      href={`/app/reviews/${owned.review.id}?beforeEvent=${nextEventCursor}#events`}
                    >
                      Older events
                      <ArrowRight aria-hidden="true" data-icon="inline-end" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
