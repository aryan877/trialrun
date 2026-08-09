import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  AgentMission,
  AgentRunMetrics,
  AgentTerminalReport,
  InfrastructurePolicyDecision,
  InfrastructureProposal,
  PolicyApprovedRecipe,
} from "@trialrun/domain";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const reviewStatusEnum = pgEnum("review_status", [
  "queued",
  "provisioning",
  "building",
  "planning",
  "running",
  "comparing",
  "publishing",
  "tearing_down",
  "completed",
  "inconclusive",
  "cancelled",
]);

export const reviewVerdictEnum = pgEnum("review_verdict", ["pass", "fail", "inconclusive"]);
export const executionProviderEnum = pgEnum("execution_provider", ["local", "zerops"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed"]);
export const analysisJobStatusEnum = pgEnum("analysis_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export const artifactSideEnum = pgEnum("artifact_side", ["base", "head", "review"]);
export const findingSeverityEnum = pgEnum("finding_severity", ["blocking", "warning"]);
export const recipeStatusEnum = pgEnum("recipe_status", [
  "proposed",
  "confirmed",
  "superseded",
  "rejected",
]);
export const agentConnectionModeEnum = pgEnum("agent_connection_mode", [
  "managed",
  "api_key",
  "codex_workspace",
]);
export const agentConnectionStatusEnum = pgEnum("agent_connection_status", [
  "pending",
  "provisioning",
  "awaiting_auth",
  "connected",
  "reauth_required",
  "revoking",
  "revoked",
  "failed",
]);
export const agentConnectionJobKindEnum = pgEnum("agent_connection_job_kind", [
  "provision",
  "authenticate",
  "verify",
  "delete",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 100 }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const githubAccounts = pgTable(
  "github_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    githubUserId: bigint("github_user_id", { mode: "number" }).notNull(),
    login: varchar("login", { length: 100 }).notNull(),
    avatarUrl: text("avatar_url"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("github_accounts_user_unique").on(table.userId),
    uniqueIndex("github_accounts_github_user_unique").on(table.githubUserId),
  ],
);

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    githubInstallationId: bigint("github_installation_id", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    accountLogin: varchar("account_login", { length: 120 }).notNull(),
    accountType: varchar("account_type", { length: 24 }).notNull(),
    repositorySelection: varchar("repository_selection", { length: 24 }).notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("github_installations_remote_unique").on(table.githubInstallationId),
    index("github_installations_owner_idx").on(table.ownerUserId),
  ],
);

export interface RepositoryConfig {
  readonly automaticReviews: boolean;
}

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "cascade" }),
    githubRepositoryId: bigint("github_repository_id", { mode: "number" }).notNull(),
    owner: varchar("owner", { length: 120 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    defaultBranch: varchar("default_branch", { length: 255 }).notNull(),
    isPrivate: boolean("is_private").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    config: jsonb("config").$type<RepositoryConfig>().notNull().default({ automaticReviews: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("repositories_remote_unique").on(table.githubRepositoryId),
    index("repositories_installation_idx").on(table.installationId),
    index("repositories_active_idx").on(table.installationId, table.isActive),
  ],
);

export const repositoryRecipes = pgTable(
  "repository_recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: recipeStatusEnum("status").notNull().default("proposed"),
    sourceSha: varchar("source_sha", { length: 40 }).notNull(),
    proposal: jsonb("proposal").$type<InfrastructureProposal>().notNull(),
    policyDecision: jsonb("policy_decision").$type<InfrastructurePolicyDecision>().notNull(),
    approvedRecipe: jsonb("approved_recipe").$type<PolicyApprovedRecipe>(),
    fingerprint: varchar("fingerprint", { length: 64 }),
    analysisJobId: uuid("analysis_job_id"),
    proposedByUserId: uuid("proposed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("repository_recipes_version_unique").on(table.repositoryId, table.version),
    index("repository_recipes_status_idx").on(table.repositoryId, table.status, table.version),
    index("repository_recipes_fingerprint_idx").on(table.repositoryId, table.fingerprint),
    uniqueIndex("repository_recipes_analysis_job_unique").on(table.analysisJobId),
    check("repository_recipes_version_positive", sql`${table.version} > 0`),
    check("repository_recipes_source_sha_format", sql`${table.sourceSha} ~ '^[0-9a-f]{40}$'`),
    check(
      "repository_recipes_confirmation_complete",
      sql`(${table.status} <> 'confirmed') or (${table.approvedRecipe} is not null and ${table.fingerprint} is not null and ${table.confirmedAt} is not null)`,
    ),
  ],
);

export const repositoryAnalysisJobs = pgTable(
  "repository_analysis_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentConnectionId: uuid("agent_connection_id"),
    sourceSha: varchar("source_sha", { length: 40 }).notNull(),
    status: analysisJobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    recipeId: uuid("recipe_id").references(() => repositoryRecipes.id, { onDelete: "set null" }),
    lastError: text("last_error"),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "repository_analysis_jobs_connection_fk",
      columns: [table.agentConnectionId],
      foreignColumns: [agentConnections.id],
    }).onDelete("restrict"),
    index("repository_analysis_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    index("repository_analysis_jobs_repository_idx").on(table.repositoryId, table.createdAt),
    index("repository_analysis_jobs_agent_connection_idx").on(
      table.agentConnectionId,
      table.createdAt,
    ),
    uniqueIndex("repository_analysis_jobs_one_active_unique")
      .on(table.repositoryId)
      .where(sql`${table.status} in ('queued', 'running')`),
    check("repository_analysis_jobs_source_sha_format", sql`${table.sourceSha} ~ '^[0-9a-f]{40}$'`),
    check("repository_analysis_jobs_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check(
      "repository_analysis_jobs_active_connection_pin",
      sql`${table.agentConnectionId} is not null or ${table.status} in ('succeeded', 'failed')`,
    ),
  ],
);

export const agentConnections = pgTable(
  "agent_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: varchar("provider", { length: 32 }).notNull().default("openai"),
    mode: agentConnectionModeEnum("mode").notNull(),
    status: agentConnectionStatusEnum("status").notNull().default("pending"),
    keyVersion: integer("key_version"),
    iv: text("iv"),
    ciphertext: text("ciphertext"),
    authTag: text("auth_tag"),
    zcpProjectId: varchar("zcp_project_id", { length: 100 }),
    zcpServiceId: varchar("zcp_service_id", { length: 100 }),
    workspaceOwnershipTokenHash: varchar("workspace_ownership_token_hash", { length: 64 }),
    workspaceBridgeUrl: text("workspace_bridge_url"),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    deletionStartedAt: timestamp("deletion_started_at", { withTimezone: true }),
    deletionCompletedAt: timestamp("deletion_completed_at", { withTimezone: true }),
    deletionProof: jsonb("deletion_proof").$type<AgentConnectionDeletionProof>(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("agent_connections_user_provider_unique").on(table.userId, table.provider),
    index("agent_connections_status_idx").on(table.status, table.updatedAt),
    check(
      "agent_connections_mode_material",
      sql`(${table.mode} = 'managed'
          and ${table.keyVersion} is null
          and ${table.iv} is null
          and ${table.ciphertext} is null
          and ${table.authTag} is null
          and ${table.zcpProjectId} is null
          and ${table.zcpServiceId} is null
          and ${table.workspaceOwnershipTokenHash} is null
          and ${table.workspaceBridgeUrl} is null
          and ${table.deletionStartedAt} is null
          and ${table.deletionCompletedAt} is null
          and ${table.deletionProof} is null)
        or (${table.mode} = 'api_key'
          and ${table.keyVersion} is not null
          and ${table.iv} is not null
          and ${table.ciphertext} is not null
          and ${table.authTag} is not null
          and ${table.zcpProjectId} is null
          and ${table.zcpServiceId} is null
          and ${table.workspaceOwnershipTokenHash} is null
          and ${table.workspaceBridgeUrl} is null
          and ${table.deletionStartedAt} is null
          and ${table.deletionCompletedAt} is null
          and ${table.deletionProof} is null)
        or (${table.mode} = 'codex_workspace'
          and ${table.keyVersion} is null
          and ${table.iv} is null
          and ${table.ciphertext} is null
          and ${table.authTag} is null)`,
    ),
    check(
      "agent_connections_workspace_material_order",
      sql`(${table.zcpServiceId} is null or ${table.zcpProjectId} is not null)
        and (${table.workspaceBridgeUrl} is null or ${table.zcpServiceId} is not null)
        and (${table.deletionCompletedAt} is null or (${table.deletionStartedAt} is not null and ${table.deletionProof} is not null))
        and (${table.deletionProof} is null or ${table.deletionCompletedAt} is not null)`,
    ),
    check(
      "agent_connections_ownership_hash_format",
      sql`${table.workspaceOwnershipTokenHash} is null or ${table.workspaceOwnershipTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "agent_connections_error_code_format",
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} ~ '^[a-z0-9][a-z0-9._-]{0,79}$'`,
    ),
  ],
);

export interface AgentConnectionDeletionProof {
  readonly provider: "zerops";
  readonly projectId: string;
  readonly observedAt: string;
  readonly result: "not_found";
}

export const agentConnectionAuthChallenges = pgTable(
  "agent_connection_auth_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull(),
    keyVersion: integer("key_version").notNull(),
    iv: text("iv").notNull(),
    ciphertext: text("ciphertext").notNull(),
    authTag: text("auth_tag").notNull(),
    verificationUri: text("verification_uri").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "agent_auth_challenges_connection_fk",
      columns: [table.connectionId],
      foreignColumns: [agentConnections.id],
    }).onDelete("restrict"),
    uniqueIndex("agent_connection_auth_challenges_connection_unique").on(table.connectionId),
    index("agent_connection_auth_challenges_expiry_idx").on(table.expiresAt),
    check("agent_connection_auth_challenges_key_version_positive", sql`${table.keyVersion} > 0`),
    check(
      "agent_connection_auth_challenges_ciphertext_complete",
      sql`length(${table.iv}) > 0 and length(${table.ciphertext}) > 0 and length(${table.authTag}) > 0`,
    ),
    check(
      "agent_connection_auth_challenges_verification_uri_safe",
      sql`${table.verificationUri} ~ '^https://[^?#]+$'`,
    ),
    check(
      "agent_connection_auth_challenges_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const agentConnectionJobs = pgTable(
  "agent_connection_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull(),
    kind: agentConnectionJobKindEnum("kind").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "agent_connection_jobs_connection_fk",
      columns: [table.connectionId],
      foreignColumns: [agentConnections.id],
    }).onDelete("restrict"),
    index("agent_connection_jobs_claim_idx").on(table.status, table.availableAt, table.createdAt),
    index("agent_connection_jobs_connection_idx").on(table.connectionId, table.createdAt),
    uniqueIndex("agent_connection_jobs_one_active_unique")
      .on(table.connectionId)
      .where(sql`${table.status} in ('queued', 'running')`),
    check("agent_connection_jobs_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check(
      "agent_connection_jobs_attempts_within_max",
      sql`${table.attempts} <= ${table.maxAttempts}`,
    ),
    check("agent_connection_jobs_max_attempts_bounded", sql`${table.maxAttempts} between 1 and 20`),
    check(
      "agent_connection_jobs_lease_material",
      sql`(${table.status} = 'running' and ${table.lockedBy} is not null and ${table.leaseExpiresAt} is not null)
        or (${table.status} <> 'running' and ${table.lockedBy} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "agent_connection_jobs_error_code_format",
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} ~ '^[a-z0-9][a-z0-9._-]{0,79}$'`,
    ),
  ],
);

export const repositorySecrets = pgTable(
  "repository_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    keyVersion: integer("key_version").notNull(),
    iv: text("iv").notNull(),
    ciphertext: text("ciphertext").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("repository_secrets_name_unique").on(table.repositoryId, table.name),
    index("repository_secrets_repository_idx").on(table.repositoryId),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => repositoryRecipes.id, { onDelete: "restrict" }),
    pullNumber: integer("pull_number").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    baseSha: varchar("base_sha", { length: 40 }).notNull(),
    headSha: varchar("head_sha", { length: 40 }).notNull(),
    status: reviewStatusEnum("status").notNull().default("queued"),
    verdict: reviewVerdictEnum("verdict"),
    provider: executionProviderEnum("provider").notNull(),
    statusMessage: text("status_message").notNull().default("Waiting for a runner"),
    plan: jsonb("plan"),
    agentConnectionId: uuid("agent_connection_id").references(() => agentConnections.id, {
      onDelete: "set null",
    }),
    agentMission: jsonb("agent_mission").$type<AgentMission>(),
    agentThreadId: varchar("agent_thread_id", { length: 160 }),
    agentTerminalReport: jsonb("agent_terminal_report").$type<AgentTerminalReport>(),
    agentRunMetrics: jsonb("agent_run_metrics").$type<AgentRunMetrics>(),
    providerProjectId: varchar("provider_project_id", { length: 100 }),
    providerOwnershipTokenHash: varchar("provider_ownership_token_hash", { length: 64 }),
    baseUrl: text("base_url"),
    headUrl: text("head_url"),
    checkRunId: bigint("check_run_id", { mode: "number" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    teardownStartedAt: timestamp("teardown_started_at", { withTimezone: true }),
    teardownCompletedAt: timestamp("teardown_completed_at", { withTimezone: true }),
    teardownAttempts: integer("teardown_attempts").notNull().default(0),
    teardownMaxAttempts: integer("teardown_max_attempts").notNull().default(5),
    teardownAvailableAt: timestamp("teardown_available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    teardownLockedBy: varchar("teardown_locked_by", { length: 160 }),
    teardownLeaseExpiresAt: timestamp("teardown_lease_expires_at", { withTimezone: true }),
    teardownLastError: text("teardown_last_error"),
    teardownProof: jsonb("teardown_proof").$type<Record<string, unknown>>(),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("reviews_owner_created_idx").on(table.ownerUserId, table.createdAt),
    index("reviews_repository_created_idx").on(table.repositoryId, table.createdAt),
    index("reviews_recipe_idx").on(table.recipeId),
    index("reviews_agent_connection_idx").on(table.agentConnectionId),
    index("reviews_status_created_idx").on(table.status, table.createdAt),
    index("reviews_zerops_cleanup_claim_idx")
      .on(table.teardownAvailableAt, table.createdAt)
      .where(
        sql`${table.provider} = 'zerops' and ${table.providerProjectId} is not null and ${table.teardownCompletedAt} is null and ${table.status} in ('completed', 'inconclusive', 'cancelled')`,
      ),
    uniqueIndex("reviews_repo_pr_head_unique")
      .on(table.repositoryId, table.pullNumber, table.headSha)
      .where(sql`${table.status} not in ('completed', 'inconclusive', 'cancelled')`),
    check("reviews_pull_number_positive", sql`${table.pullNumber} > 0`),
    check("reviews_base_sha_format", sql`${table.baseSha} ~ '^[0-9a-f]{40}$'`),
    check("reviews_head_sha_format", sql`${table.headSha} ~ '^[0-9a-f]{40}$'`),
    check("reviews_distinct_shas", sql`${table.baseSha} <> ${table.headSha}`),
    check("reviews_teardown_attempts_nonnegative", sql`${table.teardownAttempts} >= 0`),
    check(
      "reviews_teardown_max_attempts_bounded",
      sql`${table.teardownMaxAttempts} between 1 and 20`,
    ),
  ],
);

export const reviewEvents = pgTable(
  "review_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 80 }).notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("review_events_review_cursor_idx").on(table.reviewId, table.id)],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    severity: findingSeverityEnum("severity").notNull(),
    kind: varchar("kind", { length: 80 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    summary: text("summary").notNull(),
    firstDivergentStep: integer("first_divergent_step"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("findings_review_idx").on(table.reviewId)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    side: artifactSideEnum("side").notNull(),
    kind: varchar("kind", { length: 60 }).notNull(),
    storageKey: text("storage_key").notNull(),
    mediaType: varchar("media_type", { length: 120 }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("artifacts_review_created_idx").on(table.reviewId, table.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 60 }).notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    lastError: text("last_error"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("jobs_claim_idx").on(table.status, table.availableAt, table.createdAt),
    index("jobs_review_idx").on(table.reviewId),
    uniqueIndex("jobs_one_active_review_unique")
      .on(table.reviewId, table.kind)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: uuid("delivery_id").primaryKey(),
  eventName: varchar("event_name", { length: 80 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lockedBy: varchar("locked_by", { length: 64 }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type RepositoryRecipe = typeof repositoryRecipes.$inferSelect;
export type RepositoryAnalysisJob = typeof repositoryAnalysisJobs.$inferSelect;
export type AgentConnection = typeof agentConnections.$inferSelect;
export type AgentConnectionAuthChallenge = typeof agentConnectionAuthChallenges.$inferSelect;
export type AgentConnectionJob = typeof agentConnectionJobs.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
