import { spawn } from "node:child_process";

export interface CodexLogoutOptions {
  readonly codexBinary: string;
  readonly codexHome: string;
  readonly executionHome: string;
  readonly timeoutMs?: number;
}

function logoutEnvironment(options: CodexLogoutOptions): Record<string, string> {
  const environment: Record<string, string> = {
    CODEX_HOME: options.codexHome,
    HOME: options.executionHome,
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

export async function logoutCodex(options: CodexLogoutOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  await new Promise<void>((resolveProcess, rejectProcess) => {
    const child = spawn(options.codexBinary, ["logout"], {
      env: logoutEnvironment(options),
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectProcess(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolveProcess();
      else rejectProcess(new Error(`Codex logout exited with ${code ?? signal}.`));
    });
  });
}
