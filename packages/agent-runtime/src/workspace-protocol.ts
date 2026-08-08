import {
  agentMissionSchema,
  agentTerminalReportSchema,
  agentUsageSchema,
  infrastructureProposalSchema,
} from "@trialrun/domain";
import { z } from "zod";

export const workspaceAgentModel = "gpt-5.6-sol" as const;
export const workspaceAgentReasoningEffort = "medium" as const;

const workspaceMcpConnectionSchema = z.strictObject({
  mcpUrl: z.url().max(2_048),
  bearerToken: z.string().min(32).max(1_024),
});

const repositoryContextSchema = z.strictObject({
  owner: z.string().min(1).max(100),
  repository: z.string().min(1).max(100),
  pullNumber: z.number().int().positive().max(1_000_000),
  pullRequestTitle: z.string().max(240),
  pullRequestBody: z.string().max(8_000),
});

export const workspaceAnalysisInvocationSchema = z.strictObject({
  kind: z.literal("analysis"),
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/),
  repositoryTools: workspaceMcpConnectionSchema,
});

export const workspaceReviewInvocationSchema = z.strictObject({
  kind: z.literal("review"),
  mission: agentMissionSchema,
  repositoryContext: repositoryContextSchema,
  repositoryTools: workspaceMcpConnectionSchema,
  liveTools: workspaceMcpConnectionSchema,
});

export const workspaceInvocationRequestSchema = z.discriminatedUnion("kind", [
  workspaceAnalysisInvocationSchema,
  workspaceReviewInvocationSchema,
]);

export const workspaceInvocationIdSchema = z.string().uuid();

const completedToolSchema = z.strictObject({
  itemId: z.string().min(1).max(200),
  server: z.string().min(1).max(120),
  tool: z.string().min(1).max(120),
  status: z.enum(["completed", "failed"]),
});

export const workspaceLiveAgentEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("thread.started"), threadId: z.string().min(1).max(160) }),
  z.strictObject({
    type: z.enum(["tool.started", "tool.completed", "tool.failed"]),
    itemId: z.string().min(1).max(200),
    server: z.string().min(1).max(120),
    tool: z.string().min(1).max(120),
  }),
  z.strictObject({ type: z.literal("turn.completed"), usage: agentUsageSchema }),
  z.strictObject({ type: z.literal("turn.failed"), message: z.string().min(1).max(8_000) }),
]);

export const workspaceReviewRunResultSchema = z.strictObject({
  threadId: z.string().min(1).max(160),
  report: agentTerminalReportSchema,
  usage: agentUsageSchema,
  toolCalls: z.number().int().nonnegative().max(500),
  completedTools: z.array(completedToolSchema).max(500),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
});

export const workspaceInvocationResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("analysis"), proposal: infrastructureProposalSchema }),
  z.strictObject({
    kind: z.literal("review"),
    run: workspaceReviewRunResultSchema,
    events: z.array(workspaceLiveAgentEventSchema).max(1_500),
  }),
]);

export const workspaceInvocationStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({
    invocationId: workspaceInvocationIdSchema,
    status: z.literal("running"),
    startedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    invocationId: workspaceInvocationIdSchema,
    status: z.literal("succeeded"),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    result: workspaceInvocationResultSchema,
  }),
  z.strictObject({
    invocationId: workspaceInvocationIdSchema,
    status: z.literal("failed"),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    errorCode: z.enum(["agent_failed", "agent_cancelled", "agent_timed_out"]),
  }),
]);

export const workspaceInvocationAcceptedSchema = z.strictObject({
  invocationId: workspaceInvocationIdSchema,
  status: z.literal("running"),
  startedAt: z.string().datetime({ offset: true }),
});

export const workspaceProbeResultSchema = z.strictObject({
  status: z.literal("connected"),
  model: z.literal(workspaceAgentModel),
  reasoningEffort: z.literal(workspaceAgentReasoningEffort),
  proof: z.literal("typed_codex_invocation"),
});

export type WorkspaceInvocationRequest = z.infer<typeof workspaceInvocationRequestSchema>;
export type WorkspaceInvocationResult = z.infer<typeof workspaceInvocationResultSchema>;
export type WorkspaceInvocationStatus = z.infer<typeof workspaceInvocationStatusSchema>;
export type WorkspaceLiveAgentEvent = z.infer<typeof workspaceLiveAgentEventSchema>;
