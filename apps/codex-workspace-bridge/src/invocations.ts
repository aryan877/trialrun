import { randomUUID } from "node:crypto";

import {
  CodexCliInfrastructureAnalyst,
  CodexLiveAgent,
  type LiveAgentLifecycleEvent,
  workspaceAgentModel,
  workspaceAgentReasoningEffort,
  workspaceInvocationAcceptedSchema,
  workspaceInvocationRequestSchema,
  workspaceInvocationStatusSchema,
  type WorkspaceInvocationRequest,
  type WorkspaceInvocationStatus,
  type WorkspaceLiveAgentEvent,
} from "@trialrun/agent-runtime";
import { z } from "zod";

export interface WorkspaceInvocationManagerOptions {
  readonly codexBinary: string;
  readonly codexHome: string;
  readonly repositoryMcpUrl: string;
  readonly analysisTimeoutMs?: number;
  readonly now?: () => Date;
}

interface StoredInvocation {
  readonly controller: AbortController;
  state: WorkspaceInvocationStatus;
}

function terminalErrorCode(error: unknown): "agent_failed" | "agent_cancelled" | "agent_timed_out" {
  if (error instanceof DOMException && error.name === "TimeoutError") return "agent_timed_out";
  if (error instanceof Error && /timed out|timeout/i.test(error.message)) return "agent_timed_out";
  if (error instanceof Error && /abort|cancel/i.test(error.message)) return "agent_cancelled";
  return "agent_failed";
}

function lifecycleEvent(event: LiveAgentLifecycleEvent): WorkspaceLiveAgentEvent {
  return event;
}

function assertExactZeropsLiveMcpUrl(value: string): void {
  const url = new URL(value);
  if (
    url.href !== value ||
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".zerops.app") ||
    url.pathname !== "/mcp" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Live review tools must use the exact disposable Zerops executor MCP URL.");
  }
}

export class WorkspaceInvocationManager {
  readonly #options: Required<Pick<WorkspaceInvocationManagerOptions, "analysisTimeoutMs" | "now">> &
    Omit<WorkspaceInvocationManagerOptions, "analysisTimeoutMs" | "now">;
  readonly #invocations = new Map<string, StoredInvocation>();

  constructor(options: WorkspaceInvocationManagerOptions) {
    this.#options = {
      ...options,
      analysisTimeoutMs: options.analysisTimeoutMs ?? 180_000,
      now: options.now ?? (() => new Date()),
    };
  }

  start(rawRequest: unknown) {
    const request = workspaceInvocationRequestSchema.parse(rawRequest);
    if ([...this.#invocations.values()].some(({ state }) => state.status === "running")) {
      throw new Error("This Codex workspace already has an active invocation.");
    }
    if (this.#invocations.size >= 32) {
      const terminal = [...this.#invocations.entries()].find(([, value]) => value.state.status !== "running");
      if (!terminal) throw new Error("This Codex workspace invocation ledger is full.");
      this.#invocations.delete(terminal[0]);
    }
    const invocationId = randomUUID();
    const startedAt = this.#options.now().toISOString();
    const controller = new AbortController();
    const stored: StoredInvocation = {
      controller,
      state: workspaceInvocationStatusSchema.parse({ invocationId, status: "running", startedAt }),
    };
    this.#invocations.set(invocationId, stored);
    void this.#run(stored, request, invocationId, startedAt);
    return workspaceInvocationAcceptedSchema.parse(stored.state);
  }

  read(invocationId: string): WorkspaceInvocationStatus | null {
    const id = z.string().uuid().parse(invocationId);
    return this.#invocations.get(id)?.state ?? null;
  }

  cancel(invocationId: string): WorkspaceInvocationStatus | null {
    const id = z.string().uuid().parse(invocationId);
    const stored = this.#invocations.get(id);
    if (!stored) return null;
    if (stored.state.status === "running") {
      stored.controller.abort(new Error("Workspace invocation was cancelled."));
    }
    return stored.state;
  }

  cancelAll(): void {
    for (const stored of this.#invocations.values()) {
      if (stored.state.status === "running") {
        stored.controller.abort(new Error("Workspace bridge is shutting down."));
      }
    }
  }

  async #run(
    stored: StoredInvocation,
    request: WorkspaceInvocationRequest,
    invocationId: string,
    startedAt: string,
  ): Promise<void> {
    try {
      if (request.kind === "analysis") {
        const proposal = await new CodexCliInfrastructureAnalyst({
          binary: this.#options.codexBinary,
          codexHome: this.#options.codexHome,
          model: workspaceAgentModel,
          reasoningEffort: workspaceAgentReasoningEffort,
          repositoryMcpUrl: this.#options.repositoryMcpUrl,
          timeoutMs: this.#options.analysisTimeoutMs,
        }).analyze({
          sourceSha: request.sourceSha,
          repositoryTools: request.repositoryTools,
          signal: stored.controller.signal,
        });
        stored.state = workspaceInvocationStatusSchema.parse({
          invocationId,
          status: "succeeded",
          startedAt,
          completedAt: this.#options.now().toISOString(),
          result: { kind: "analysis", proposal },
        });
        return;
      }

      assertExactZeropsLiveMcpUrl(request.liveTools.mcpUrl);
      const events: WorkspaceLiveAgentEvent[] = [];
      const run = await new CodexLiveAgent({
        codexBinary: this.#options.codexBinary,
        model: workspaceAgentModel,
        reasoningEffort: workspaceAgentReasoningEffort,
        repositoryMcpUrl: this.#options.repositoryMcpUrl,
      }).run({
        mission: request.mission,
        repositoryContext: request.repositoryContext,
        repositoryTools: request.repositoryTools,
        liveTools: request.liveTools,
        codexHome: this.#options.codexHome,
        signal: stored.controller.signal,
        onEvent: (event) => {
          events.push(lifecycleEvent(event));
          return Promise.resolve();
        },
      });
      stored.state = workspaceInvocationStatusSchema.parse({
        invocationId,
        status: "succeeded",
        startedAt,
        completedAt: this.#options.now().toISOString(),
        result: { kind: "review", run, events },
      });
    } catch (error) {
      stored.state = workspaceInvocationStatusSchema.parse({
        invocationId,
        status: "failed",
        startedAt,
        completedAt: this.#options.now().toISOString(),
        errorCode: terminalErrorCode(error),
      });
    }
  }
}

export const workspaceInvocationInternals = { assertExactZeropsLiveMcpUrl } as const;
