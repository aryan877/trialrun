import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { z } from "zod";

const ansiPattern = new RegExp(String.raw`\x1B\[[0-?]*[ -/]*[@-~]`, "g");
const deviceUrlSchema = z.literal("https://auth.openai.com/codex/device");
const deviceCodeSchema = z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4,8}$/);
const maximumOutputBytes = 16_384;
const loginLifetimeMs = 15 * 60_000;

export type DeviceLoginState =
  | { readonly status: "idle" }
  | {
      readonly status: "awaiting_auth";
      readonly verificationUri: "https://auth.openai.com/codex/device";
      readonly userCode: string;
      readonly expiresAt: string;
    }
  | { readonly status: "connected" }
  | { readonly status: "failed"; readonly errorCode: "login_failed" | "login_expired" };

export interface DeviceLoginOptions {
  readonly codexBinary: string;
  readonly codexHome: string;
  readonly executionHome: string;
  readonly now?: () => number;
}

function cleanOutput(value: string): string {
  return value.replace(ansiPattern, "");
}

function parseChallenge(output: string, now: number): Extract<DeviceLoginState, { status: "awaiting_auth" }> | null {
  const clean = cleanOutput(output);
  const uri = clean.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0];
  const code = clean.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/)?.[0];
  if (!uri || !code) return null;
  return {
    status: "awaiting_auth",
    verificationUri: deviceUrlSchema.parse(uri),
    userCode: deviceCodeSchema.parse(code),
    expiresAt: new Date(now + loginLifetimeMs).toISOString(),
  };
}

export class DeviceLoginManager {
  readonly #options: DeviceLoginOptions;
  readonly #now: () => number;
  #child: ChildProcessWithoutNullStreams | null = null;
  #state: DeviceLoginState = { status: "idle" };

  constructor(options: DeviceLoginOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  state(): DeviceLoginState {
    if (
      this.#state.status === "awaiting_auth" &&
      new Date(this.#state.expiresAt).getTime() <= this.#now()
    ) {
      this.cancel();
      this.#state = { status: "failed", errorCode: "login_expired" };
    }
    return this.#state;
  }

  async start(): Promise<Extract<DeviceLoginState, { status: "awaiting_auth" | "connected" }>> {
    const current = this.state();
    if (current.status === "awaiting_auth" || current.status === "connected") return current;
    await mkdir(this.#options.codexHome, { recursive: true, mode: 0o700 });
    await mkdir(this.#options.executionHome, { recursive: true, mode: 0o700 });
    const child = spawn(this.#options.codexBinary, ["login", "--device-auth"], {
      env: {
        CODEX_HOME: this.#options.codexHome,
        HOME: this.#options.executionHome,
        LANG: process.env.LANG ?? "C.UTF-8",
        NO_COLOR: "1",
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        TERM: "dumb",
        ...(process.env.SSL_CERT_DIR ? { SSL_CERT_DIR: process.env.SSL_CERT_DIR } : {}),
        ...(process.env.SSL_CERT_FILE ? { SSL_CERT_FILE: process.env.SSL_CERT_FILE } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    child.stdin.end();
    let output = "";

    return new Promise((resolve, reject) => {
      let settled = false;
      const challengeTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.cancel();
        this.#state = { status: "failed", errorCode: "login_failed" };
        reject(new Error("Codex did not return a device challenge in time."));
      }, 20_000);
      const consume = (chunk: Buffer): void => {
        output = `${output}${chunk.toString("utf8")}`.slice(-maximumOutputBytes);
        const challenge = parseChallenge(output, this.#now());
        if (!challenge || settled) return;
        settled = true;
        clearTimeout(challengeTimeout);
        this.#state = challenge;
        resolve(challenge);
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(challengeTimeout);
          this.#state = { status: "failed", errorCode: "login_failed" };
          reject(error);
        }
      });
      child.once("exit", (code) => {
        this.#child = null;
        if (code === 0) {
          this.#state = { status: "connected" };
        } else if (this.#state.status !== "failed") {
          this.#state = { status: "failed", errorCode: "login_failed" };
        }
        if (!settled) {
          settled = true;
          clearTimeout(challengeTimeout);
          if (code === 0) resolve({ status: "connected" });
          else reject(new Error("Codex device login ended before returning a challenge."));
        }
      });
    });
  }

  cancel(): void {
    this.#child?.kill("SIGTERM");
    this.#child = null;
  }
}

export const deviceLoginInternals = { cleanOutput, parseChallenge } as const;
