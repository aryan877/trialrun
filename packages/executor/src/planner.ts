import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { testPlanSchema, type TestPlan } from "@trialrun/domain";
import { z } from "zod";

export interface PlannerInput {
  readonly pullRequestTitle: string;
  readonly pullRequestBody: string;
  readonly diff: string;
  readonly repositoryNotes: string;
  readonly availableSecretNames: readonly string[];
}

export interface ReviewPlanner {
  plan(input: PlannerInput): Promise<TestPlan>;
}

export interface CodexPlannerOptions {
  readonly binary?: string;
  readonly timeoutMs?: number;
}

export class CodexCliPlanner implements ReviewPlanner {
  readonly #binary: string;
  readonly #timeoutMs: number;

  constructor(options: CodexPlannerOptions = {}) {
    this.#binary = options.binary ?? "codex";
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  async plan(input: PlannerInput): Promise<TestPlan> {
    const directory = await mkdtemp(join(tmpdir(), "trialrun-planner-"));
    const schemaPath = join(directory, "plan.schema.json");
    const outputPath = join(directory, "plan.json");
    const schema = z.toJSONSchema(testPlanSchema, { target: "draft-7" });
    await writeFile(schemaPath, JSON.stringify(schema), { encoding: "utf8", mode: 0o600 });

    const prompt = [
      "You are TrialRun's bounded review planner.",
      "Return only a small executable test plan matching the supplied JSON Schema.",
      "Use semantic locators. Do not invent secret values, scripts, shell commands, CSS selectors, or external URLs.",
      "Test the riskiest user-visible behavior changed by this pull request. A later deterministic executor owns the verdict.",
      `Available secret names (values are intentionally hidden): ${input.availableSecretNames.join(", ") || "none"}`,
      `Repository notes:\n${input.repositoryNotes.slice(0, 8_000)}`,
      `PR title: ${input.pullRequestTitle.slice(0, 500)}`,
      `PR body:\n${input.pullRequestBody.slice(0, 8_000)}`,
      `Diff:\n${input.diff.slice(0, 80_000)}`,
    ].join("\n\n");

    try {
      await new Promise<void>((resolveProcess, rejectProcess) => {
        const child = spawn(
          this.#binary,
          [
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            "--cd",
            directory,
            "-",
          ],
          { stdio: ["pipe", "ignore", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000);
        });
        child.stdin.end(prompt);
        const timeout = setTimeout(() => child.kill("SIGKILL"), this.#timeoutMs);
        child.once("error", (error) => {
          clearTimeout(timeout);
          rejectProcess(error);
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          if (code === 0) resolveProcess();
          else rejectProcess(new Error(`Codex planner exited with ${code ?? signal}: ${stderr}`));
        });
      });
      const raw = await readFile(outputPath, "utf8");
      const parsedPlan: unknown = JSON.parse(raw);
      return testPlanSchema.parse(parsedPlan);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
