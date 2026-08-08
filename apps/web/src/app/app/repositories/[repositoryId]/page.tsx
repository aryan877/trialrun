import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Check,
  CircleDashed,
  Database,
  KeyRound,
  Lock,
  OctagonAlert,
  Play,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  repositoryAnalysisJobs,
  repositoryRecipes,
  repositorySecrets,
  reviews,
  type RepositoryAnalysisJob,
  type RepositoryRecipe,
} from "@trialrun/db";
import type { EvidenceCitation, InfrastructureProposal } from "@trialrun/domain";

import { productAuth } from "@/components/product-auth";
import {
  Definition,
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
import { ownedRepository } from "@/lib/reviews";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ApplicationService = InfrastructureProposal["applications"][number];
type ManagedDependency = InfrastructureProposal["dependencies"][number];

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function setupNotice(query: Record<string, string | string[] | undefined>): {
  readonly tone: "success" | "info" | "warning" | "error";
  readonly message: string;
} | null {
  if (firstValue(query.analysis) === "queued") {
    return {
      tone: "info",
      message:
        "Repository analysis is queued. The runner will inspect bounded repository evidence at the current default-branch SHA.",
    };
  }
  if (firstValue(query.recipe) === "confirmed") {
    return {
      tone: "success",
      message:
        "The infrastructure recipe is confirmed and can now be used for pull request reviews.",
    };
  }
  if (firstValue(query.secret) === "updated") {
    return {
      tone: "success",
      message:
        "The test-secret vault was updated. Secret values remain encrypted and are never shown here.",
    };
  }
  const error = firstValue(query.error);
  if (error === "secret") {
    return {
      tone: "error",
      message:
        "The secret change was rejected. Only names required by the confirmed recipe can be stored.",
    };
  }
  if (error === "analysis") {
    return { tone: "error", message: "Repository analysis could not be queued." };
  }
  if (error === "confirmation") {
    return { tone: "error", message: "The proposed recipe could not be confirmed." };
  }
  return null;
}

function AnalysisState({ analysis }: { readonly analysis: RepositoryAnalysisJob | undefined }) {
  if (!analysis) {
    return <StateBadge icon={CircleDashed}>Not analyzed</StateBadge>;
  }
  if (analysis.status === "queued") {
    return (
      <StateBadge icon={CircleDashed} tone="info">
        Queued
      </StateBadge>
    );
  }
  if (analysis.status === "running") {
    return (
      <StateBadge icon={Activity} tone="running">
        Running
      </StateBadge>
    );
  }
  if (analysis.status === "succeeded") {
    return (
      <StateBadge icon={Check} tone="success">
        Succeeded
      </StateBadge>
    );
  }
  return (
    <StateBadge icon={OctagonAlert} tone="failure">
      Failed
    </StateBadge>
  );
}

function RecipeState({ recipe }: { readonly recipe: RepositoryRecipe | undefined }) {
  if (!recipe) {
    return <StateBadge icon={CircleDashed}>No recipe</StateBadge>;
  }
  if (recipe.status === "confirmed") {
    return (
      <StateBadge icon={ShieldCheck} tone="success">
        Confirmed v{recipe.version}
      </StateBadge>
    );
  }
  if (recipe.status === "proposed") {
    return (
      <StateBadge icon={TriangleAlert} tone="warning">
        Proposed v{recipe.version}
      </StateBadge>
    );
  }
  if (recipe.status === "rejected") {
    return (
      <StateBadge icon={OctagonAlert} tone="failure">
        Rejected v{recipe.version}
      </StateBadge>
    );
  }
  return <StateBadge>Superseded v{recipe.version}</StateBadge>;
}

function ResourceSummary({ resources }: { readonly resources: ApplicationService["resources"] }) {
  return (
    <span>
      {resources.minCpu}–{resources.maxCpu} CPU · {resources.minRamGb}–{resources.maxRamGb} GB RAM ·{" "}
      {resources.minDiskGb}–{resources.maxDiskGb} GB disk
    </span>
  );
}

function EvidenceList({ evidence }: { readonly evidence: readonly EvidenceCitation[] }) {
  return (
    <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
      {evidence.map((citation, index) => (
        <li
          className="grid grid-cols-[minmax(0,auto)_1fr] gap-2 text-[11px] leading-4"
          key={`${citation.path}-${citation.lineStart ?? 0}-${index}`}
        >
          <code className="break-all font-mono text-signal-info">
            {citation.path}
            {citation.lineStart ? `:${citation.lineStart}` : ""}
            {citation.lineEnd && citation.lineEnd !== citation.lineStart
              ? `–${citation.lineEnd}`
              : ""}
          </code>
          <span className="text-muted-foreground">
            {citation.summary} ({citation.confidence})
          </span>
        </li>
      ))}
    </ul>
  );
}

function ApplicationCard({ service }: { readonly service: ApplicationService }) {
  return (
    <article className="panel-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.08em] text-signal-info uppercase">
            Application
          </p>
          <h3 className="mt-1 truncate text-base leading-6 font-medium">{service.name}</h3>
        </div>
        {service.testTarget ? (
          <StateBadge icon={Play} tone="running">
            Test target
          </StateBadge>
        ) : null}
      </div>
      <dl className="mt-3">
        <Definition term="Runtime">{service.zeropsType}</Definition>
        <Definition term="Source / setup">
          <code className="font-mono text-xs">{service.sourceRoot}</code> · {service.setup}
        </Definition>
        <Definition term="Readiness path">
          <code className="font-mono text-xs">{service.healthPath}</code>
        </Definition>
        <Definition term="Resource bounds">
          <ResourceSummary resources={service.resources} />
        </Definition>
        <Definition term="Network">
          {service.publicAccess ? "Public access proposed" : "Private service"}
        </Definition>
      </dl>
      <EvidenceList evidence={service.evidence} />
    </article>
  );
}

function DependencyCard({ service }: { readonly service: ManagedDependency }) {
  return (
    <article className="panel-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.08em] text-signal-warning uppercase">
            Managed dependency
          </p>
          <h3 className="mt-1 truncate text-base leading-6 font-medium">{service.name}</h3>
        </div>
        <Database aria-hidden="true" className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm leading-5 text-muted-foreground">{service.purpose}</p>
      <dl className="mt-3">
        <Definition term="Service type">{service.zeropsType}</Definition>
        {service.resources ? (
          <Definition term="Resource bounds">
            <ResourceSummary resources={service.resources} />
          </Definition>
        ) : null}
        {service.storageSizeGb ? (
          <Definition term="Storage">{service.storageSizeGb} GB</Definition>
        ) : null}
      </dl>
      <EvidenceList evidence={service.evidence} />
    </article>
  );
}

export default async function RepositorySetup({
  params,
  searchParams,
}: {
  readonly params: Promise<{ repositoryId: string }>;
  readonly searchParams: SearchParams;
}) {
  const [{ repositoryId: rawRepositoryId }, auth, query] = await Promise.all([
    params,
    productAuth(),
    searchParams,
  ]);
  if (!auth) redirect("/login?auth=required");
  const parsedId = z.string().uuid().safeParse(rawRepositoryId);
  if (!parsedId.success) notFound();

  const source = await ownedRepository(auth.user.id, parsedId.data);
  if (!source) notFound();

  const db = database();
  const [analysisRows, recipeRows, confirmedRecipeRows, secretRows, recentReviewRows] =
    await Promise.all([
      db
        .select()
        .from(repositoryAnalysisJobs)
        .where(
          and(
            eq(repositoryAnalysisJobs.repositoryId, source.repository.id),
            eq(repositoryAnalysisJobs.requestedByUserId, auth.user.id),
          ),
        )
        .orderBy(desc(repositoryAnalysisJobs.createdAt))
        .limit(10),
      db
        .select()
        .from(repositoryRecipes)
        .where(eq(repositoryRecipes.repositoryId, source.repository.id))
        .orderBy(desc(repositoryRecipes.version))
        .limit(10),
      db
        .select()
        .from(repositoryRecipes)
        .where(
          and(
            eq(repositoryRecipes.repositoryId, source.repository.id),
            eq(repositoryRecipes.status, "confirmed"),
          ),
        )
        .orderBy(desc(repositoryRecipes.version))
        .limit(1),
      db
        .select({
          id: repositorySecrets.id,
          name: repositorySecrets.name,
          keyVersion: repositorySecrets.keyVersion,
          updatedAt: repositorySecrets.updatedAt,
        })
        .from(repositorySecrets)
        .where(eq(repositorySecrets.repositoryId, source.repository.id))
        .orderBy(repositorySecrets.name),
      db
        .select()
        .from(reviews)
        .where(
          and(
            eq(reviews.repositoryId, source.repository.id),
            eq(reviews.ownerUserId, auth.user.id),
          ),
        )
        .orderBy(desc(reviews.createdAt))
        .limit(8),
    ]);

  const latestAnalysis = analysisRows[0];
  const latestRecipe = recipeRows[0];
  const proposedRecipe = recipeRows.find((recipe) => recipe.status === "proposed");
  const confirmedRecipe = confirmedRecipeRows[0];
  const shownRecipe = latestRecipe?.approvedRecipe ?? latestRecipe?.proposal;
  const requiredSecretNames = confirmedRecipe?.approvedRecipe
    ? [
        ...new Set(
          confirmedRecipe.approvedRecipe.secretBindings.map(({ secretName }) => secretName),
        ),
      ]
    : [];
  const requiredSecretNameSet = new Set(requiredSecretNames);
  const unboundSecrets = secretRows.filter((secret) => !requiredSecretNameSet.has(secret.name));
  const storedSecrets = new Map(secretRows.map((secret) => [secret.name, secret]));
  const analysisActive =
    latestAnalysis?.status === "queued" || latestAnalysis?.status === "running";
  const notice = setupNotice(query);

  return (
    <>
      <PageHeader
        actions={
          <Button asChild className="h-9 rounded-[2px]" variant="ghost">
            <Link href="/app#repositories">
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Workspace
            </Link>
          </Button>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <GitBranch aria-hidden="true" className="size-3" />
              {source.repository.defaultBranch}
            </span>
            <span aria-hidden="true">·</span>
            <span>{source.repository.isPrivate ? "Private" : "Public"}</span>
            <span aria-hidden="true">·</span>
            <span>{source.installation.accountLogin}</span>
          </span>
        }
        eyebrow="Repository setup"
        title={`${source.repository.owner}/${source.repository.name}`}
      />

      <div className="space-y-12 px-4 py-6 sm:py-8">
        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

        <section className="grid overflow-hidden rounded-[4px] border border-border lg:grid-cols-3">
          <article className="border-b border-border p-4 lg:border-r lg:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                  01 / Analyze
                </p>
                <h2 className="mt-1 text-base font-medium">Repository evidence</h2>
              </div>
              <AnalysisState analysis={latestAnalysis} />
            </div>
            <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">
              Reads bounded manifests and configuration at the current default-branch SHA.
            </p>
            <form
              action={`/api/repositories/${source.repository.id}/analyze`}
              className="mt-4"
              method="post"
            >
              <input name="csrf" type="hidden" value={auth.csrfToken} />
              <Button
                className="h-9 w-full rounded-[2px]"
                disabled={analysisActive}
                type="submit"
                variant="outline"
              >
                {analysisActive
                  ? "Analysis in progress"
                  : latestAnalysis
                    ? "Run analysis again"
                    : "Analyze repository"}
              </Button>
            </form>
          </article>

          <article className="border-b border-border p-4 lg:border-r lg:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                  02 / Confirm
                </p>
                <h2 className="mt-1 text-base font-medium">Infrastructure recipe</h2>
              </div>
              <RecipeState recipe={latestRecipe} />
            </div>
            <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">
              A maintainer confirms the policy-approved services before any pull request can run.
            </p>
            {proposedRecipe?.approvedRecipe ? (
              <form
                action={`/api/recipes/${proposedRecipe.id}/confirm`}
                className="mt-4"
                method="post"
              >
                <input name="csrf" type="hidden" value={auth.csrfToken} />
                <Button className="h-9 w-full rounded-[2px]" type="submit">
                  Confirm recipe v{proposedRecipe.version}
                  <Check aria-hidden="true" data-icon="inline-end" />
                </Button>
              </form>
            ) : (
              <Button
                className="mt-4 h-9 w-full rounded-[2px]"
                disabled
                type="button"
                variant="outline"
              >
                No confirmable proposal
              </Button>
            )}
          </article>

          <article className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                  03 / Review
                </p>
                <h2 className="mt-1 text-base font-medium">Pull request run</h2>
              </div>
              {confirmedRecipe ? (
                <StateBadge icon={Play} tone="running">
                  Ready
                </StateBadge>
              ) : (
                <StateBadge icon={Lock}>Blocked</StateBadge>
              )}
            </div>
            <form action="/api/reviews" className="mt-3 space-y-3" method="post">
              <input name="csrf" type="hidden" value={auth.csrfToken} />
              <input name="repositoryId" type="hidden" value={source.repository.id} />
              <div>
                <label className="field-label" htmlFor="pullNumber">
                  Open pull request number
                </label>
                <input
                  className="field-control"
                  disabled={!confirmedRecipe}
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
                className="h-9 w-full rounded-[2px]"
                disabled={!confirmedRecipe}
                type="submit"
              >
                Queue review
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            </form>
          </article>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="panel-surface p-4">
            <SectionHeading title="Latest analysis" />
            {latestAnalysis ? (
              <dl className="mt-3">
                <Definition term="State">
                  <AnalysisState analysis={latestAnalysis} />
                </Definition>
                <Definition term="Source commit">
                  <Sha value={latestAnalysis.sourceSha} />
                </Definition>
                <Definition term="Attempts">
                  {latestAnalysis.attempts} of {latestAnalysis.maxAttempts}
                </Definition>
                <Definition term="Created">{formatTimestamp(latestAnalysis.createdAt)}</Definition>
                <Definition term="Runner lease">
                  {latestAnalysis.leaseExpiresAt
                    ? formatTimestamp(latestAnalysis.leaseExpiresAt)
                    : "No active lease"}
                </Definition>
                {latestAnalysis.lastError ? (
                  <Definition term="Last error">
                    <span className="text-destructive">{latestAnalysis.lastError}</span>
                  </Definition>
                ) : null}
              </dl>
            ) : (
              <p className="mt-3 text-sm leading-5 text-muted-foreground">
                No analysis job has been recorded.
              </p>
            )}
          </div>
          <div className="panel-surface p-4">
            <SectionHeading title="Review policy" />
            <dl className="mt-3">
              <Definition term="Automatic reviews">
                {source.repository.config.automaticReviews
                  ? "Enabled for ready pull requests"
                  : "Disabled; manual runs only"}
              </Definition>
              <Definition term="Execution recipe">
                {confirmedRecipe
                  ? `Confirmed version ${confirmedRecipe.version}`
                  : "No confirmed recipe"}
              </Definition>
              <Definition term="Provider isolation">
                Base and PR receive separate stateful dependencies from the confirmed recipe.
              </Definition>
            </dl>
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
              Automatic-review preference is stored on the repository. The current backend exposes
              no mutation route for this setting.
            </p>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="recipe">
          <SectionHeading
            description={
              latestRecipe
                ? `Version ${latestRecipe.version}, derived from ${latestRecipe.sourceSha.slice(0, 8)}. Policy output and cited repository evidence are shown without modification.`
                : "Run repository analysis to produce a typed infrastructure proposal."
            }
            id="recipe"
            title="Analysis and recipe"
          />
          {!latestRecipe || !shownRecipe ? (
            <EmptyState
              description="The bounded analyst has not produced an infrastructure proposal for this repository."
              title="No recipe proposal"
            />
          ) : (
            <div className="space-y-4">
              <div className="panel-surface p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <RecipeState recipe={latestRecipe} />
                    <p className="mt-3 max-w-4xl text-sm leading-6">{shownRecipe.summary}</p>
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                      Source SHA
                    </p>
                    <p className="mt-1">
                      <Sha value={latestRecipe.sourceSha} />
                    </p>
                  </div>
                </div>

                {latestRecipe.proposal.unresolvedQuestions.length > 0 ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs font-medium text-signal-warning">
                      Unresolved topology questions
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                      {latestRecipe.proposal.unresolvedQuestions.map((question, index) => (
                        <li key={`${index}-${question}`}>{question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {latestRecipe.policyDecision.errors.length > 0 ||
                latestRecipe.policyDecision.warnings.length > 0 ? (
                  <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2">
                    {latestRecipe.policyDecision.errors.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-destructive">Policy blockers</p>
                        <ul className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
                          {latestRecipe.policyDecision.errors.map((issue, index) => (
                            <li key={`${issue.code}-${issue.path}-${index}`}>
                              <code className="font-mono text-destructive">
                                {issue.path || issue.code}
                              </code>{" "}
                              — {issue.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {latestRecipe.policyDecision.warnings.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-signal-warning">
                          Policy adjustments
                        </p>
                        <ul className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
                          {latestRecipe.policyDecision.warnings.map((issue, index) => (
                            <li key={`${issue.code}-${issue.path}-${index}`}>
                              <code className="font-mono text-signal-warning">{issue.path}</code> —{" "}
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {shownRecipe.applications.map((service) => (
                  <ApplicationCard key={`application-${service.name}`} service={service} />
                ))}
                {shownRecipe.dependencies.map((service) => (
                  <DependencyCard key={`dependency-${service.name}`} service={service} />
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="panel-surface overflow-hidden">
                  <div className="flex h-11 items-center gap-2 border-b border-border px-3">
                    <GitBranch aria-hidden="true" className="size-4 text-signal-info" />
                    <h3 className="text-sm font-medium">Service environment bindings</h3>
                  </div>
                  {shownRecipe.environmentBindings.length === 0 ? (
                    <p className="px-3 py-5 text-sm text-muted-foreground">
                      No service-derived variables were proposed.
                    </p>
                  ) : (
                    <ul>
                      {shownRecipe.environmentBindings.map((binding) => (
                        <li
                          className="border-b border-border px-3 py-3 last:border-b-0"
                          key={`${binding.targetService}-${binding.environmentName}`}
                        >
                          <p className="font-mono text-xs">
                            {binding.targetService}.{binding.environmentName}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            from {binding.sourceService}.{binding.sourceProperty}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="panel-surface overflow-hidden">
                  <div className="flex h-11 items-center gap-2 border-b border-border px-3">
                    <KeyRound aria-hidden="true" className="size-4 text-signal-warning" />
                    <h3 className="text-sm font-medium">Secret bindings</h3>
                  </div>
                  {shownRecipe.secretBindings.length === 0 ? (
                    <p className="px-3 py-5 text-sm text-muted-foreground">
                      This recipe does not require stored secrets.
                    </p>
                  ) : (
                    <ul>
                      {shownRecipe.secretBindings.map((binding) => (
                        <li
                          className="border-b border-border px-3 py-3 last:border-b-0"
                          key={`${binding.targetService}-${binding.environmentName}-${binding.secretName}`}
                        >
                          <p className="font-mono text-xs">{binding.secretName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            injected as {binding.targetService}.{binding.environmentName}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4" aria-labelledby="secrets">
          <SectionHeading
            description="Only names required by the confirmed recipe are accepted. Values are write-only in this interface."
            id="secrets"
            title="Test-secret vault"
          />
          <Notice tone="warning">
            Use disposable testing credentials only. Do not add production databases, payment keys,
            cloud credentials, or personal accounts. Tested code can intentionally exfiltrate any
            value it receives.
          </Notice>
          {requiredSecretNames.length === 0 ? (
            <EmptyState
              description={
                confirmedRecipe
                  ? "The confirmed recipe has no test-secret bindings."
                  : "Confirm a policy-approved recipe before storing any repository secret."
              }
              title={confirmedRecipe ? "No secrets required" : "Secrets locked until confirmation"}
            />
          ) : (
            <ul className="overflow-hidden rounded-[4px] border border-border">
              {requiredSecretNames.map((name) => {
                const stored = storedSecrets.get(name);
                return (
                  <li
                    className="grid gap-4 border-b border-border p-3 last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end"
                    key={name}
                  >
                    <div>
                      <code className="font-mono text-sm">{name}</code>
                      <div className="mt-1">
                        {stored ? (
                          <StateBadge icon={ShieldCheck} tone="success">
                            Stored · key v{stored.keyVersion}
                          </StateBadge>
                        ) : (
                          <StateBadge icon={TriangleAlert} tone="warning">
                            Missing
                          </StateBadge>
                        )}
                      </div>
                      {stored ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Updated {formatTimestamp(stored.updatedAt)}
                        </p>
                      ) : null}
                    </div>
                    <form
                      action={`/api/repositories/${source.repository.id}/secrets`}
                      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                      method="post"
                    >
                      <input name="csrf" type="hidden" value={auth.csrfToken} />
                      <input name="intent" type="hidden" value="set" />
                      <input name="name" type="hidden" value={name} />
                      <div>
                        <label className="sr-only" htmlFor={`secret-${name}`}>
                          {stored ? "Replacement value" : "Value"} for {name}
                        </label>
                        <input
                          autoComplete="new-password"
                          className="field-control"
                          id={`secret-${name}`}
                          maxLength={4_096}
                          name="value"
                          placeholder={
                            stored ? "Enter a replacement value" : "Enter the test-only value"
                          }
                          required
                          type="password"
                        />
                      </div>
                      <Button className="h-9 rounded-[2px]" type="submit" variant="outline">
                        {stored ? "Replace" : "Store"}
                      </Button>
                    </form>
                    {stored ? (
                      <form
                        action={`/api/repositories/${source.repository.id}/secrets`}
                        method="post"
                      >
                        <input name="csrf" type="hidden" value={auth.csrfToken} />
                        <input name="intent" type="hidden" value="delete" />
                        <input name="name" type="hidden" value={name} />
                        <Button
                          aria-label={`Delete ${name}`}
                          className="h-9 rounded-[2px]"
                          type="submit"
                          variant="destructive"
                        >
                          <Trash2 aria-hidden="true" />
                          Delete
                        </Button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {unboundSecrets.length > 0 ? (
            <div className="space-y-3">
              <Notice tone="warning">
                {unboundSecrets.length} encrypted secret record
                {unboundSecrets.length === 1 ? " is" : "s are"} no longer bound by the confirmed
                recipe. The existing secret API does not permit deleting an unbound name.
              </Notice>
              <ul className="overflow-hidden rounded-[4px] border border-border">
                {unboundSecrets.map((secret) => (
                  <li
                    className="flex flex-col gap-1 border-b border-border px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                    key={secret.id}
                  >
                    <code className="font-mono text-xs">{secret.name}</code>
                    <span className="text-[10px] text-muted-foreground">
                      Vault key v{secret.keyVersion} · updated {formatTimestamp(secret.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="space-y-4" aria-labelledby="history">
          <SectionHeading
            description="Recent immutable review attempts for this repository."
            id="history"
            title="Review history"
          />
          {recentReviewRows.length === 0 ? (
            <EmptyState
              description="Queue an open pull request above after the recipe and required secrets are ready."
              title="No repository reviews yet"
            />
          ) : (
            <ul className="overflow-hidden rounded-[4px] border border-border">
              {recentReviewRows.map((review) => (
                <li className="border-b border-border last:border-b-0" key={review.id}>
                  <Link
                    className="group grid gap-3 px-3 py-3 outline-none transition-colors hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_140px_150px_24px] sm:items-center"
                    href={`/app/reviews/${review.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <span className="text-muted-foreground">#{review.pullNumber}</span>{" "}
                        {review.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Base <Sha value={review.baseSha} /> → PR <Sha value={review.headSha} />
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
                      className="hidden size-4 text-muted-foreground group-hover:text-foreground sm:block"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {recipeRows.length > 1 ? (
          <section className="space-y-4" aria-labelledby="versions">
            <SectionHeading id="versions" title="Recipe versions" />
            <ul className="overflow-hidden rounded-[4px] border border-border">
              {recipeRows.map((recipe) => (
                <li
                  className="grid gap-2 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[130px_120px_1fr_180px] sm:items-center"
                  key={recipe.id}
                >
                  <span className="text-sm font-medium">Version {recipe.version}</span>
                  <RecipeState recipe={recipe} />
                  <span className="text-xs text-muted-foreground">
                    <Sha value={recipe.sourceSha} />
                  </span>
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={recipe.createdAt.toISOString()}
                  >
                    {formatTimestamp(recipe.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
