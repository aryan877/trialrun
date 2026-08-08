import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import {
  workspaceAgentModel,
  workspaceAgentReasoningEffort,
  workspaceProbeResultSchema,
} from "./workspace-protocol.js";

export interface CodexConnectionProbeOptions {
  readonly binary?: string;
  readonly codexHome: string;
  readonly executionHome: string;
  readonly timeoutMs?: number;
}

const disabledFeatures = [
  "apply_patch_freeform",
  "apps",
  "browser_use",
  "computer_use",
  "connectors",
  "in_app_browser",
  "js_repl",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "standalone_web_search",
  "tool_search",
  "unified_exec",
  "view_image",
  "web_search",
  "web_search_cached",
  "web_search_request",
] as const;

function safeEnvironment(codexHome: string, executionHome: string): Record<string, string> {
  const environment: Record<string, string> = {
    CODEX_HOME: codexHome,
    HOME: executionHome,
    LANG: process.env.LANG ?? "C.UTF-8",
    NO_COLOR: "1",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    TERM: "dumb",
  };
  for (const name of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_DIR", "SSL_CERT_FILE"] as const) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

async function exactDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path.`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symbolic link.`);
  }
  return realpath(path);
}

export class CodexConnectionProbe {
  readonly #binary: string;
  readonly #codexHome: string;
  readonly #executionHome: string;
  readonly #timeoutMs: number;

  constructor(options: CodexConnectionProbeOptions) {
    this.#binary = options.binary ?? "codex";
    this.#codexHome = options.codexHome;
    this.#executionHome = options.executionHome;
    this.#timeoutMs = z
      .number()
      .int()
      .min(5_000)
      .max(120_000)
      .parse(options.timeoutMs ?? 60_000);
  }

  async run(signal?: AbortSignal): Promise<z.infer<typeof workspaceProbeResultSchema>> {
    const [codexHome, executionHome] = await Promise.all([
      exactDirectory(this.#codexHome, "Probe Codex home"),
      exactDirectory(this.#executionHome, "Probe execution home"),
    ]);
    const directory = await mkdtemp(join(tmpdir(), "trialrun-codex-probe-"));
    const schemaPath = join(directory, "probe.schema.json");
    const outputPath = join(directory, "probe.json");
    await writeFile(
      schemaPath,
      JSON.stringify(z.toJSONSchema(workspaceProbeResultSchema, { target: "draft-7" })),
      { encoding: "utf8", mode: 0o600 },
    );
    const prompt = JSON.stringify({
      instruction: "Return exactly the fixed JSON object required by the output schema.",
      status: "connected",
      model: workspaceAgentModel,
      reasoningEffort: workspaceAgentReasoningEffort,
      proof: "typed_codex_invocation",
    });
    try {
      await new Promise<void>((resolveProcess, rejectProcess) => {
        const timeoutController = new AbortController();
        const timeout = setTimeout(
          () => timeoutController.abort(new Error("Codex connection probe timed out.")),
          this.#timeoutMs,
        );
        const combinedSignal = signal
          ? AbortSignal.any([signal, timeoutController.signal])
          : timeoutController.signal;
        const child = spawn(
          this.#binary,
          [
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--model",
            workspaceAgentModel,
            "--config",
            `model_reasoning_effort=${JSON.stringify(workspaceAgentReasoningEffort)}`,
            "--strict-config",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            "--cd",
            directory,
            "-c",
            "agents.enabled=false",
            "-c",
            "include_apps_instructions=false",
            "-c",
            "include_collaboration_mode_instructions=false",
            "-c",
            "include_environment_context=false",
            "-c",
            'approval_policy="never"',
            "-c",
            'web_search="disabled"',
            "-c",
            "sandbox_workspace_write.network_access=false",
            ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
            "-",
          ],
          {
            env: safeEnvironment(codexHome, executionHome),
            stdio: ["pipe", "ignore", "ignore"],
            signal: combinedSignal,
          },
        );
        child.stdin.end(prompt);
        child.once("error", (error) => {
          clearTimeout(timeout);
          rejectProcess(error);
        });
        child.once("exit", (code, exitSignal) => {
          clearTimeout(timeout);
          if (code === 0) resolveProcess();
          else
            rejectProcess(new Error(`Codex connection probe exited with ${code ?? exitSignal}.`));
        });
      });
      const raw = await readFile(outputPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      return workspaceProbeResultSchema.parse(parsed);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
