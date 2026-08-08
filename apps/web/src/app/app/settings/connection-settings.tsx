"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  Laptop,
  LoaderCircle,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  openAiConnectionApiResponseSchema,
  type OpenAiConnectionMetadata,
} from "@/app/api/agent-connections/openai/contract";
import {
  workspaceConnectionApiResponseSchema,
  type WorkspaceConnectionAction,
  type WorkspaceConnectionMetadata,
} from "@/app/api/agent-connections/openai/workspace/contract";
import { StateBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

type RootAction = "managed" | "api_key" | "root_revoke";
type WorkspaceAction = WorkspaceConnectionAction["intent"];
type PendingAction = RootAction | WorkspaceAction | null;
type Notice = { readonly tone: "success" | "error"; readonly message: string } | null;

function timestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function workspaceIsSelected(workspace: WorkspaceConnectionMetadata): boolean {
  return workspace.status !== "not_configured" && workspace.status !== "revoked";
}

function workspaceOwnsConnectionRecord(workspace: WorkspaceConnectionMetadata): boolean {
  return workspace.status !== "not_configured";
}

function workspaceIsBusy(workspace: WorkspaceConnectionMetadata): boolean {
  return (
    workspace.operation !== null ||
    ["pending", "provisioning", "revoking"].includes(workspace.status)
  );
}

function WorkspaceState({ workspace }: { readonly workspace: WorkspaceConnectionMetadata }) {
  if (workspace.operation) {
    const label = {
      provision: "Creating workspace",
      authenticate: "Preparing authorization",
      verify: "Verifying authorization",
      delete: "Removing workspace",
    }[workspace.operation];
    return (
      <StateBadge icon={LoaderCircle} tone="running">
        {label}
      </StateBadge>
    );
  }
  switch (workspace.status) {
    case "pending":
      return <StateBadge tone="info">Queued</StateBadge>;
    case "provisioning":
      return (
        <StateBadge icon={LoaderCircle} tone="running">
          Creating workspace
        </StateBadge>
      );
    case "awaiting_auth":
      return (
        <StateBadge icon={TriangleAlert} tone="warning">
          Authorization needed
        </StateBadge>
      );
    case "connected":
      return (
        <StateBadge icon={Check} tone="success">
          Connected
        </StateBadge>
      );
    case "reauth_required":
      return (
        <StateBadge icon={TriangleAlert} tone="warning">
          Reauthorization needed
        </StateBadge>
      );
    case "revoking":
      return (
        <StateBadge icon={LoaderCircle} tone="running">
          Removing workspace
        </StateBadge>
      );
    case "failed":
      return (
        <StateBadge icon={TriangleAlert} tone="failure">
          Needs attention
        </StateBadge>
      );
    case "revoked":
      return <StateBadge>Revoked</StateBadge>;
    case "not_configured":
      return <StateBadge>Not configured</StateBadge>;
  }
}

function CurrentConnection({
  connection,
  workspace,
}: {
  readonly connection: OpenAiConnectionMetadata;
  readonly workspace: WorkspaceConnectionMetadata;
}) {
  if (workspaceOwnsConnectionRecord(workspace)) return <WorkspaceState workspace={workspace} />;
  if (!connection.configured || !connection.mode) {
    return <StateBadge>Not configured</StateBadge>;
  }
  return (
    <StateBadge icon={Check} tone="success">
      {connection.mode === "managed" ? "TrialRun-managed" : "Encrypted API key"}
    </StateBadge>
  );
}

function workspaceSuccessMessage(action: WorkspaceAction): string {
  switch (action) {
    case "connect":
      return "Workspace setup was queued. This page will update as each step finishes.";
    case "verify":
      return "Authorization verification was queued. TrialRun will only mark it connected after verification succeeds.";
    case "retry":
      return "The failed workspace step was queued again.";
    case "revoke":
      return "Workspace removal was queued. Access remains in revoking state until deletion is recorded.";
  }
}

export function ConnectionSettings({
  csrfToken,
  initialConnection,
  initialWorkspace,
}: {
  readonly csrfToken: string;
  readonly initialConnection: OpenAiConnectionMetadata;
  readonly initialWorkspace: WorkspaceConnectionMetadata;
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [apiKey, setApiKey] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (
      workspace.status === "not_configured" ||
      workspace.status === "connected" ||
      workspace.status === "revoked" ||
      workspace.status === "failed" ||
      workspace.status === "reauth_required"
    ) {
      return;
    }
    const refresh = async (): Promise<void> => {
      try {
        const httpResponse = await fetch("/api/agent-connections/openai/workspace", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const payload: unknown = await httpResponse.json();
        const parsed = workspaceConnectionApiResponseSchema.parse(payload);
        if (httpResponse.ok && parsed.ok) setWorkspace(parsed.workspace);
      } catch {
        // The next poll or an explicit action can recover without exposing transport details.
      }
    };
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [workspace.status]);

  const mutateRoot = async (
    action: RootAction,
    request: { readonly method: "PUT" | "DELETE"; readonly body: Readonly<Record<string, string>> },
  ): Promise<void> => {
    setPendingAction(action);
    setNotice(null);
    try {
      const httpResponse = await fetch("/api/agent-connections/openai", {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(request.body),
      });
      const payload: unknown = await httpResponse.json();
      const parsed = openAiConnectionApiResponseSchema.parse(payload);
      if (!httpResponse.ok || !parsed.ok) {
        setNotice({
          tone: "error",
          message: parsed.ok ? "The connection change was not accepted." : parsed.error,
        });
        return;
      }
      setConnection(parsed.connection);
      if (action === "api_key") setApiKey("");
      setNotice({
        tone: "success",
        message:
          action === "root_revoke"
            ? "The OpenAI connection was revoked and stored key material was cleared."
            : action === "managed"
              ? "Future reviews will use TrialRun-managed model access."
              : "The API key was encrypted and stored. Its value cannot be read back here.",
      });
    } catch {
      setNotice({
        tone: "error",
        message: "The connection service could not complete the request.",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const mutateWorkspace = async (action: WorkspaceAction): Promise<void> => {
    setPendingAction(action);
    setNotice(null);
    try {
      const httpResponse = await fetch("/api/agent-connections/openai/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ intent: action, csrfToken }),
      });
      const payload: unknown = await httpResponse.json();
      const parsed = workspaceConnectionApiResponseSchema.parse(payload);
      if (!httpResponse.ok || !parsed.ok) {
        setNotice({
          tone: "error",
          message: parsed.ok ? "The workspace change was not accepted." : parsed.error,
        });
        return;
      }
      setWorkspace(parsed.workspace);
      if (workspaceIsSelected(parsed.workspace)) {
        setConnection(emptyOpenAiConnection);
        setApiKey("");
      }
      setNotice({ tone: "success", message: workspaceSuccessMessage(action) });
    } catch {
      setNotice({
        tone: "error",
        message: "The workspace connection service could not complete the request.",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const workspaceSelected = workspaceIsSelected(workspace);
  const workspaceOwnsRecord = workspaceOwnsConnectionRecord(workspace);
  const workspaceBusy = workspaceIsBusy(workspace);
  const busy = pendingAction !== null;
  const rootConfigured = connection.configured && Boolean(connection.mode);
  const workspaceCanConnect =
    workspace.status === "not_configured" || workspace.status === "revoked";
  const workspaceCanRetry =
    workspace.status === "failed" ||
    workspace.status === "reauth_required" ||
    (workspace.status === "awaiting_auth" && !workspace.verification);

  return (
    <div className="space-y-6">
      {notice ? (
        <div
          className={
            notice.tone === "success"
              ? "rounded-[4px] border border-signal-running/35 bg-signal-running/7 px-3 py-2.5 text-sm leading-5"
              : "rounded-[4px] border border-destructive/35 bg-destructive/7 px-3 py-2.5 text-sm leading-5"
          }
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      ) : null}

      <section
        className="overflow-hidden rounded-[4px] border border-border"
        aria-labelledby="connection-mode"
      >
        <div className="grid border-b border-border bg-black/10 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-signal-info uppercase">
              Active model path
            </p>
            <h2 className="mt-1 text-lg font-medium" id="connection-mode">
              OpenAI connection
            </h2>
          </div>
          <div className="mt-3 sm:mt-0">
            <CurrentConnection connection={connection} workspace={workspace} />
          </div>
        </div>

        <div className="grid xl:grid-cols-3">
          <article className="border-b border-border p-4 sm:p-5 xl:border-r xl:border-b-0">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[3px] border border-signal-info/30 bg-signal-info/8 text-signal-info">
                <ServerCog aria-hidden="true" className="size-[18px]" />
              </span>
              <div>
                <h3 className="text-base font-medium">TrialRun-managed</h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Use the server-side model connection operated by TrialRun. No customer API key is
                  stored for this mode.
                </p>
              </div>
            </div>
            <ul className="mt-5 space-y-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
              <li>Tested code never receives the model credential.</li>
              <li>The same bounded repository and browser tools still apply.</li>
            </ul>
            <Button
              className="mt-5 h-9 w-full rounded-[2px]"
              disabled={
                busy ||
                workspaceOwnsRecord ||
                (connection.configured && connection.mode === "managed")
              }
              onClick={() =>
                void mutateRoot("managed", {
                  method: "PUT",
                  body: { mode: "managed", csrfToken },
                })
              }
              type="button"
              variant="outline"
            >
              {pendingAction === "managed" ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              {connection.configured && connection.mode === "managed"
                ? "Currently selected"
                : "Use managed access"}
            </Button>
          </article>

          <article className="border-b border-border p-4 sm:p-5 xl:border-r xl:border-b-0">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[3px] border border-signal-warning/30 bg-signal-warning/8 text-signal-warning">
                <KeyRound aria-hidden="true" className="size-[18px]" />
              </span>
              <div>
                <h3 className="text-base font-medium">Your OpenAI API key</h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Store one API key encrypted with the TrialRun vault. The key is write-only: it is
                  never returned by the API or shown again.
                </p>
              </div>
            </div>
            <form
              className="mt-5 border-t border-border pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void mutateRoot("api_key", {
                  method: "PUT",
                  body: { mode: "api_key", apiKey, csrfToken },
                });
              }}
            >
              <label className="field-label" htmlFor="openai-api-key">
                {connection.configured && connection.mode === "api_key"
                  ? "Replacement API key"
                  : "OpenAI API key"}
              </label>
              <input
                autoComplete="new-password"
                className="field-control font-mono"
                disabled={busy || workspaceOwnsRecord}
                id="openai-api-key"
                maxLength={4_096}
                minLength={20}
                name="openaiApiKey"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  connection.configured && connection.mode === "api_key"
                    ? "Enter a new key to replace the stored value"
                    : "Paste a test-scoped OpenAI API key"
                }
                required
                spellCheck={false}
                type="password"
                value={apiKey}
              />
              <Button
                className="mt-3 h-9 w-full rounded-[2px]"
                disabled={busy || workspaceOwnsRecord || apiKey.length < 20}
                type="submit"
              >
                {pendingAction === "api_key" ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <KeyRound aria-hidden="true" />
                )}
                {connection.configured && connection.mode === "api_key"
                  ? "Replace encrypted key"
                  : "Encrypt and store key"}
              </Button>
            </form>
          </article>

          <article className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[3px] border border-signal-running/30 bg-signal-running/8 text-signal-running">
                <Laptop aria-hidden="true" className="size-[18px]" />
              </span>
              <div>
                <h3 className="text-base font-medium">Your Codex subscription</h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Authorize Codex inside a dedicated TrialRun workspace. No OpenAI API key is needed
                  for this path.
                </p>
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <WorkspaceState workspace={workspace} />
                {workspace.updatedAt ? (
                  <span className="text-[10px] text-muted-foreground">
                    Updated {timestamp(workspace.updatedAt)}
                  </span>
                ) : null}
              </div>

              {workspace.status === "awaiting_auth" && workspace.verification ? (
                <div className="mt-4 rounded-[3px] border border-signal-warning/30 bg-signal-warning/7 p-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Open the official Codex device page, then enter this short-lived code:
                  </p>
                  <code className="mt-3 block font-mono text-xl font-semibold tracking-[0.12em]">
                    {workspace.verification.userCode}
                  </code>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Expires {timestamp(workspace.verification.expiresAt)}
                  </p>
                  <Button asChild className="mt-3 h-9 w-full rounded-[2px]" variant="outline">
                    <a
                      href={workspace.verification.verificationUri}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open Codex authorization
                      <ExternalLink aria-hidden="true" data-icon="inline-end" />
                    </a>
                  </Button>
                  <Button
                    className="mt-2 h-9 w-full rounded-[2px]"
                    disabled={busy || workspaceBusy}
                    onClick={() => void mutateWorkspace("verify")}
                    type="button"
                  >
                    {pendingAction === "verify" ? (
                      <LoaderCircle aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Check aria-hidden="true" />
                    )}
                    I&apos;ve authorized Codex — verify
                  </Button>
                </div>
              ) : null}

              {workspaceCanConnect ? (
                <Button
                  className="mt-4 h-9 w-full rounded-[2px]"
                  disabled={busy}
                  onClick={() => void mutateWorkspace("connect")}
                  type="button"
                >
                  {pendingAction === "connect" ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Laptop aria-hidden="true" />
                  )}
                  Connect my Codex
                </Button>
              ) : null}

              {workspaceCanRetry ? (
                <div className="mt-4">
                  {workspace.status === "awaiting_auth" && !workspace.verification ? (
                    <p className="mb-2 text-xs leading-5 text-muted-foreground">
                      The authorization code is unavailable or expired. Request a fresh code to
                      continue.
                    </p>
                  ) : null}
                  <Button
                    className="h-9 w-full rounded-[2px]"
                    disabled={busy || workspaceBusy}
                    onClick={() => void mutateWorkspace("retry")}
                    type="button"
                    variant="outline"
                  >
                    {pendingAction === "retry" ? (
                      <LoaderCircle aria-hidden="true" className="animate-spin" />
                    ) : (
                      <RefreshCw aria-hidden="true" />
                    )}
                    Retry workspace step
                  </Button>
                </div>
              ) : null}

              {workspace.status === "connected" ? (
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  TrialRun verified this workspace at {timestamp(workspace.lastVerifiedAt)}. The
                  workspace credential remains inside the dedicated workspace.
                </p>
              ) : null}
              {workspaceIsSelected(workspace) && workspace.status !== "connected" ? (
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  TrialRun will not use or label this workspace connected until verification
                  succeeds.
                </p>
              ) : null}
              {rootConfigured && !workspaceSelected ? (
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Connecting replaces the currently selected model path and clears customer API-key
                  material when applicable.
                </p>
              ) : null}
            </div>
          </article>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="panel-surface p-4 sm:p-5">
          <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Connection record
          </p>
          <dl className="mt-3 grid gap-px overflow-hidden rounded-[3px] border border-border bg-border sm:grid-cols-3">
            {[
              ["Provider", "OpenAI"],
              [
                "Mode",
                workspaceOwnsRecord
                  ? "Codex subscription workspace"
                  : connection.mode === "managed"
                    ? "TrialRun-managed"
                    : connection.mode === "api_key"
                      ? "Encrypted API key"
                      : "Not configured",
              ],
              [
                "Updated",
                timestamp(workspaceOwnsRecord ? workspace.updatedAt : connection.updatedAt),
              ],
            ].map(([term, value]) => (
              <div className="bg-background px-3 py-3" key={term}>
                <dt className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {term}
                </dt>
                <dd className="mt-1 text-xs leading-5">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Workspace lifecycle state comes from the durable connection record. TrialRun never
            infers “connected” from a button click or a queued job.
          </p>
        </article>

        <article className="rounded-[4px] border border-border p-4 sm:p-5">
          <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-signal-warning uppercase">
            Revoke access
          </p>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            {workspaceSelected
              ? "Revocation queues deletion of the dedicated workspace and keeps the status visible until deletion is recorded."
              : "Revocation clears encrypted API-key material and leaves a non-secret audit state."}
          </p>
          <Button
            className="mt-4 h-9 w-full rounded-[2px]"
            disabled={busy || workspaceBusy || (!workspaceSelected && !connection.configured)}
            onClick={() => {
              if (workspaceSelected) void mutateWorkspace("revoke");
              else {
                void mutateRoot("root_revoke", {
                  method: "DELETE",
                  body: { csrfToken },
                });
              }
            }}
            type="button"
            variant="destructive"
          >
            {pendingAction === "revoke" || pendingAction === "root_revoke" ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            {workspaceSelected ? "Revoke and remove workspace" : "Revoke connection"}
          </Button>
        </article>
      </section>
    </div>
  );
}

const emptyOpenAiConnection: OpenAiConnectionMetadata = {
  provider: "openai",
  configured: false,
  mode: null,
  status: "not_configured",
  updatedAt: null,
  lastVerifiedAt: null,
};
