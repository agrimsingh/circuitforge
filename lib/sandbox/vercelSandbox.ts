import { Sandbox } from "@vercel/sandbox";

export interface SandboxSmokeTestResult {
  sandboxId: string;
  runtime: "node24" | "node22" | "python3.13";
  exitCode: number | null;
  stdout: string;
  durationMs: number;
}

const DEFAULT_RUNTIME: SandboxSmokeTestResult["runtime"] = "node24";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function getAuthSetupMessage() {
  return [
    "Vercel Sandbox authentication is not configured.",
    "Run `vercel link` in this repo, then run `vercel env pull`.",
    "Ensure VERCEL_OIDC_TOKEN exists in your local env (or configure a Vercel access token fallback).",
  ].join(" ");
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runVercelSandboxSmokeTest(): Promise<SandboxSmokeTestResult> {
  let sandbox: Sandbox | null = null;
  const startedAt = Date.now();

  try {
    sandbox = await Sandbox.create({
      runtime: DEFAULT_RUNTIME,
      timeout: DEFAULT_TIMEOUT_MS,
    });

    const command = await sandbox.runCommand("echo", ["Hello from Vercel Sandbox!"]);
    const stdout = (await command.stdout()).trim();

    return {
      sandboxId: sandbox.sandboxId,
      runtime: DEFAULT_RUNTIME,
      exitCode: command.exitCode,
      stdout,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    const missingAuth =
      message.toLowerCase().includes("oidc") ||
      message.toLowerCase().includes("token") ||
      message.toLowerCase().includes("unauthorized");

    throw new Error(missingAuth ? `${message} ${getAuthSetupMessage()}` : message);
  } finally {
    if (sandbox) {
      await sandbox.stop().catch(() => {
        // No-op: sandbox may already be stopped/expired.
      });
    }
  }
}
