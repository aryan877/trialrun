import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";

import { agentConnections } from "@trialrun/db";

import { openAiConnectionMetadata } from "@/app/api/agent-connections/openai/contract";
import { readWorkspaceConnection } from "@/app/api/agent-connections/openai/workspace/service";
import { productAuth } from "@/components/product-auth";
import { Notice, PageHeader, SectionHeading } from "@/components/product-ui";
import { database } from "@/lib/db";

import { ConnectionSettings } from "./connection-settings";

export default async function SettingsPage() {
  const auth = await productAuth();
  if (!auth) redirect("/login?auth=required");

  const [[record], workspace] = await Promise.all([
    database()
      .select({
        mode: agentConnections.mode,
        status: agentConnections.status,
        updatedAt: agentConnections.updatedAt,
        lastVerifiedAt: agentConnections.lastVerifiedAt,
      })
      .from(agentConnections)
      .where(
        and(eq(agentConnections.userId, auth.user.id), eq(agentConnections.provider, "openai")),
      )
      .limit(1),
    readWorkspaceConnection(auth.user.id),
  ]);
  const connection = openAiConnectionMetadata(record?.mode === "codex_workspace" ? null : record);

  return (
    <>
      <PageHeader
        description="Choose who supplies the model credential for your bounded TrialRun reviews."
        eyebrow="Workspace settings"
        title="Model access"
      />
      <div className="space-y-10 px-4 py-6 sm:py-8">
        <section className="space-y-4" aria-labelledby="openai-access">
          <SectionHeading
            description="One OpenAI connection is active per TrialRun account. Choosing a Codex workspace replaces managed access or an encrypted API key, then keeps its lifecycle visible through revocation."
            id="openai-access"
            title="Review model"
          />
          <Notice tone="warning">
            A customer API key is used only by the persistent runner. It is never injected into the
            repository, tested application, disposable review project, browser evidence, or logs.
          </Notice>
          <ConnectionSettings
            csrfToken={auth.csrfToken}
            initialConnection={connection}
            initialWorkspace={workspace}
          />
        </section>

        <section
          className="rounded-[4px] border border-dashed border-border px-4 py-5"
          aria-labelledby="workspace-access"
        >
          <p className="font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            What this connection does
          </p>
          <h2 className="mt-1 text-base font-medium" id="workspace-access">
            Your Codex subscription, isolated for TrialRun
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            TrialRun creates a dedicated private workspace and asks you to authorize Codex with a
            short-lived device code. The screen reports each setup step and only says connected
            after the stored workspace state is verified. TrialRun never reads or displays the
            workspace credential files.
          </p>
        </section>
      </div>
    </>
  );
}
