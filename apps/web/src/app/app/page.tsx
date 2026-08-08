import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  GitBranch,
  Check,
  CircleDashed,
  GitFork,
  Globe2,
  Lock,
  OctagonAlert,
  Play,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { and, asc, count, desc, eq, inArray, lt, notInArray, or } from "drizzle-orm";
import { z } from "zod";

import {
  githubInstallations,
  repositories,
  repositoryAnalysisJobs,
  repositoryRecipes,
  reviews,
  type RepositoryAnalysisJob,
  type RepositoryRecipe,
} from "@trialrun/db";

import { productAuth } from "@/components/product-auth";
import {
  EmptyState,
  formatTimestamp,
  Notice,
  PageHeader,
  SectionHeading,
  Sha,
} from "@/components/product-ui";
import { ReviewStatusBadge, StateBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { database } from "@/lib/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const terminalStatuses: ("completed" | "inconclusive" | "cancelled")[] = [
  "completed",
  "inconclusive",
  "cancelled",
];

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function reviewCursor(query: Record<string, string | string[] | undefined>): {
  readonly date: Date;
  readonly id: string;
} | null {
  const timestamp = firstValue(query.before);
  const id = firstValue(query.beforeId);
  if (!timestamp || !id || !z.string().uuid().safeParse(id).success) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : { date, id };
}

function RepositoryReadiness({
  analysis,
  recipe,
}: {
  readonly analysis: RepositoryAnalysisJob | undefined;
  readonly recipe: RepositoryRecipe | undefined;
}) {
  if (analysis?.status === "queued") {
    return (
      <StateBadge icon={CircleDashed} tone="info">
        Setup check queued
      </StateBadge>
    );
  }
  if (analysis?.status === "running") {
    return (
      <StateBadge icon={Activity} tone="running">
        Checking setup
      </StateBadge>
    );
  }
  if (recipe?.status === "confirmed") {
    return (
      <StateBadge icon={Check} tone="success">
        Setup approved
      </StateBadge>
    );
  }
  if (recipe?.status === "proposed") {
    return (
      <StateBadge icon={TriangleAlert} tone="warning">
        Approval needed
      </StateBadge>
    );
  }
  if (recipe?.status === "rejected" || analysis?.status === "failed") {
    return (
      <StateBadge icon={OctagonAlert} tone="failure">
        Setup blocked
      </StateBadge>
    );
  }
  return <StateBadge icon={CircleDashed}>Setup check needed</StateBadge>;
}

function dashboardNotice(query: Record<string, string | string[] | undefined>): {
  readonly tone: "success" | "info" | "warning" | "error";
  readonly message: string;
} | null {
  const github = firstValue(query.github);
  const error = firstValue(query.error);
  if (github === "connected") {
    return {
      tone: "success",
      message: "GitHub is connected and the selected repositories were synchronized.",
    };
  }
  if (github === "failed") {
    return {
      tone: "error",
      message: "GitHub authorization did not complete. No repository access was changed.",
    };
  }
  if (github === "unavailable") {
    return {
      tone: "warning",
      message: "The GitHub App is not available in the current deployment.",
    };
  }
  if (error === "review") {
    return {
      tone: "error",
      message:
        "The review could not be queued. Approve the repository setup and choose an open, review-ready pull request.",
    };
  }
  if (error === "logout") {
    return { tone: "error", message: "The session could not be closed. Refresh and try again." };
  }
  if (error === "analysis") {
    return { tone: "error", message: "The setup check could not be queued." };
  }
  if (error === "confirmation") {
    return { tone: "error", message: "The repository setup could not be approved." };
  }
  return null;
}

export default async function Dashboard({ searchParams }: { readonly searchParams: SearchParams }) {
  const [auth, query] = await Promise.all([productAuth(), searchParams]);
  if (!auth) redirect("/login?auth=required");

  const db = database();
  const cursor = reviewCursor(query);
  const ownerCondition = and(
    eq(reviews.ownerUserId, auth.user.id),
    eq(githubInstallations.ownerUserId, auth.user.id),
  );
  const olderCondition = cursor
    ? or(
        lt(reviews.createdAt, cursor.date),
        and(eq(reviews.createdAt, cursor.date), lt(reviews.id, cursor.id)),
      )
    : undefined;
  const pageCondition = olderCondition ? and(ownerCondition, olderCondition) : ownerCondition;

  const [repositoryRows, reviewRows, totalReviewRows, activeReviewRows] = await Promise.all([
    db
      .select({ repository: repositories, installation: githubInstallations })
      .from(repositories)
      .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
      .where(
        and(eq(githubInstallations.ownerUserId, auth.user.id), eq(repositories.isActive, true)),
      )
      .orderBy(asc(repositories.owner), asc(repositories.name)),
    db
      .select({
        review: reviews,
        repositoryOwner: repositories.owner,
        repositoryName: repositories.name,
      })
      .from(reviews)
      .innerJoin(repositories, eq(reviews.repositoryId, repositories.id))
      .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
      .where(pageCondition)
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(21),
    db.select({ value: count() }).from(reviews).where(eq(reviews.ownerUserId, auth.user.id)),
    db
      .select({ value: count() })
      .from(reviews)
      .where(
        and(eq(reviews.ownerUserId, auth.user.id), notInArray(reviews.status, terminalStatuses)),
      ),
  ]);

  const repositoryIds = repositoryRows.map(({ repository }) => repository.id);
  const [recipeRows, analysisRows] = repositoryIds.length
    ? await Promise.all([
        db
          .select()
          .from(repositoryRecipes)
          .where(inArray(repositoryRecipes.repositoryId, repositoryIds))
          .orderBy(desc(repositoryRecipes.version)),
        db
          .select()
          .from(repositoryAnalysisJobs)
          .where(inArray(repositoryAnalysisJobs.repositoryId, repositoryIds))
          .orderBy(desc(repositoryAnalysisJobs.createdAt)),
      ])
    : [[], []];

  const latestRecipeByRepository = new Map<string, RepositoryRecipe>();
  const confirmedRecipeByRepository = new Map<string, RepositoryRecipe>();
  for (const recipe of recipeRows) {
    if (!latestRecipeByRepository.has(recipe.repositoryId)) {
      latestRecipeByRepository.set(recipe.repositoryId, recipe);
    }
    if (recipe.status === "confirmed" && !confirmedRecipeByRepository.has(recipe.repositoryId)) {
      confirmedRecipeByRepository.set(recipe.repositoryId, recipe);
    }
  }
  const latestAnalysisByRepository = new Map<string, RepositoryAnalysisJob>();
  for (const analysis of analysisRows) {
    if (!latestAnalysisByRepository.has(analysis.repositoryId)) {
      latestAnalysisByRepository.set(analysis.repositoryId, analysis);
    }
  }

  const eligibleRepositories = repositoryRows.filter(({ repository }) =>
    confirmedRecipeByRepository.has(repository.id),
  );
  const hasMoreReviews = reviewRows.length > 20;
  const visibleReviews = reviewRows.slice(0, 20);
  const nextCursor = visibleReviews.at(-1)?.review;
  const notice = dashboardNotice(query);

  return (
    <>
      <PageHeader
        actions={
          <Button asChild className="h-9 rounded-[2px] px-4" variant="outline">
            <a href="/api/github/install">
              <GitFork aria-hidden="true" data-icon="inline-start" />
              Add repositories
            </a>
          </Button>
        }
        description="Connected repositories, setup readiness, and immutable base-versus-PR reviews."
        eyebrow="Control plane"
        title="Workspace"
      />

      <div className="space-y-12 px-4 py-6 sm:py-8">
        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <dl className="grid overflow-hidden rounded-[4px] border border-border sm:grid-cols-3">
          {[
            { term: "Connected repositories", value: repositoryRows.length },
            { term: "Recorded reviews", value: totalReviewRows[0]?.value ?? 0 },
            { term: "Active reviews", value: activeReviewRows[0]?.value ?? 0 },
          ].map((metric) => (
            <div
              className="border-b border-border px-4 py-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
              key={metric.term}
            >
              <dt className="text-[10px] leading-4 font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {metric.term}
              </dt>
              <dd className="mt-2 font-mono text-3xl leading-9 tracking-[-0.04em]">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="repositories" className="space-y-4">
          <SectionHeading
            description="Run a setup check, review how TrialRun will run the repository, and approve it before starting a review."
            id="repositories"
            title="Connected repositories"
          />
          {repositoryRows.length === 0 ? (
            <EmptyState
              actionLabel="Connect GitHub"
              description="Install the TrialRun GitHub App and select the repositories whose pull requests you want to execute."
              href="/api/github/install"
              title="No repositories connected"
            />
          ) : (
            <ul className="overflow-hidden rounded-[4px] border border-border">
              {repositoryRows.map(({ repository, installation }) => {
                const recipe = latestRecipeByRepository.get(repository.id);
                const analysis = latestAnalysisByRepository.get(repository.id);
                return (
                  <li className="border-b border-border last:border-b-0" key={repository.id}>
                    <Link
                      className="group grid gap-3 px-3 py-3 outline-none transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_180px_180px_28px] sm:items-center"
                      href={`/app/repositories/${repository.id}`}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          {repository.isPrivate ? (
                            <Lock
                              aria-label="Private repository"
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                          ) : (
                            <Globe2
                              aria-label="Public repository"
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                          )}
                          <p className="truncate text-sm font-medium">
                            <span className="text-muted-foreground">{repository.owner}/</span>
                            {repository.name}
                          </p>
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <GitBranch aria-hidden="true" className="size-3" />
                          {repository.defaultBranch}
                        </p>
                      </div>
                      <RepositoryReadiness analysis={analysis} recipe={recipe} />
                      <div className="text-xs leading-5 text-muted-foreground">
                        <span className="block truncate">{installation.accountLogin}</span>
                        <span>
                          {repository.config.automaticReviews
                            ? "Automatic reviews on"
                            : "Manual reviews only"}
                        </span>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground sm:block"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" id="reviews">
          <div className="min-w-0 space-y-4">
            <SectionHeading
              description="Newest review attempts first. Every row points to one repository, pull request, base SHA, and head SHA."
              id="review-list"
              title="Reviews"
            />
            {visibleReviews.length === 0 ? (
              <EmptyState
                description={
                  cursor
                    ? "There are no older reviews before this cursor. Return to the latest results."
                    : "Queue an open, review-ready pull request after approving its repository setup."
                }
                href={cursor ? "/app#reviews" : undefined}
                actionLabel={cursor ? "Back to latest" : undefined}
                title={cursor ? "End of review history" : "No reviews recorded"}
              />
            ) : (
              <div>
                <ul className="overflow-hidden rounded-[4px] border border-border">
                  {visibleReviews.map(({ review, repositoryOwner, repositoryName }) => (
                    <li className="border-b border-border last:border-b-0" key={review.id}>
                      <Link
                        className="group grid gap-3 px-3 py-3 outline-none transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_130px_150px_28px] sm:items-center"
                        href={`/app/reviews/${review.id}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            <span className="text-muted-foreground">#{review.pullNumber}</span>{" "}
                            {review.title}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {repositoryOwner}/{repositoryName} · <Sha value={review.headSha} />
                          </p>
                        </div>
                        <ReviewStatusBadge status={review.status} verdict={review.verdict} />
                        <time
                          className="text-xs text-muted-foreground"
                          dateTime={review.createdAt.toISOString()}
                        >
                          {formatTimestamp(review.createdAt)}
                        </time>
                        <ArrowRight
                          aria-hidden="true"
                          className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground sm:block"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between gap-3">
                  {cursor ? (
                    <Button asChild className="rounded-[2px]" size="sm" variant="ghost">
                      <Link href="/app#reviews">Back to latest</Link>
                    </Button>
                  ) : (
                    <span />
                  )}
                  {hasMoreReviews && nextCursor ? (
                    <Button asChild className="rounded-[2px]" size="sm" variant="outline">
                      <Link
                        href={`/app?before=${encodeURIComponent(nextCursor.createdAt.toISOString())}&beforeId=${nextCursor.id}#reviews`}
                      >
                        Older reviews
                        <ArrowRight aria-hidden="true" data-icon="inline-end" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <aside className="panel-surface h-fit p-4 sm:p-5" aria-labelledby="run-review">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.08em] text-signal-running uppercase">
                  Manual trigger
                </p>
                <h2 className="mt-1 text-lg leading-6 font-medium" id="run-review">
                  Run a pull request
                </h2>
              </div>
              <Play aria-hidden="true" className="size-5 text-signal-running" />
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              TrialRun resolves the open pull request through GitHub and records both immutable
              commit SHAs before queueing.
            </p>
            <form action="/api/reviews" className="mt-5 space-y-4" method="post">
              <input name="csrf" type="hidden" value={auth.csrfToken} />
              <div>
                <label className="field-label" htmlFor="repositoryId">
                  Approved repository
                </label>
                <select
                  className="field-control"
                  disabled={eligibleRepositories.length === 0}
                  id="repositoryId"
                  name="repositoryId"
                  required
                >
                  {eligibleRepositories.length === 0 ? (
                    <option value="">No approved repository available</option>
                  ) : (
                    eligibleRepositories.map(({ repository }) => (
                      <option key={repository.id} value={repository.id}>
                        {repository.owner}/{repository.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="pullNumber">
                  Pull request number
                </label>
                <input
                  className="field-control"
                  id="pullNumber"
                  inputMode="numeric"
                  max={1_000_000}
                  min={1}
                  name="pullNumber"
                  placeholder="42"
                  required
                  type="number"
                />
              </div>
              <Button
                className="h-10 w-full rounded-[2px]"
                disabled={eligibleRepositories.length === 0}
                type="submit"
              >
                Queue review
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            </form>
            {eligibleRepositories.length === 0 && repositoryRows.length > 0 ? (
              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-signal-warning">
                <Settings2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                Open a repository, run the setup check, and approve the proposed setup first.
              </p>
            ) : null}
          </aside>
        </section>
      </div>
    </>
  );
}
