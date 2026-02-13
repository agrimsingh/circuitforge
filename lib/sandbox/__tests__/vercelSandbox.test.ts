import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { runVercelSandboxSmokeTest } from "../vercelSandbox";

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

describe("runVercelSandboxSmokeTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a command and returns stdout", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const command = {
      exitCode: 0,
      stdout: vi.fn().mockResolvedValue("Hello from Vercel Sandbox!\n"),
    };
    const sandbox = {
      sandboxId: "sandbox_123",
      runCommand: vi.fn().mockResolvedValue(command),
      stop,
    };

    (Sandbox.create as unknown as Mock).mockResolvedValue(sandbox);

    const result = await runVercelSandboxSmokeTest();

    expect(result.sandboxId).toBe("sandbox_123");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello from Vercel Sandbox!");
    expect(sandbox.runCommand).toHaveBeenCalledWith("echo", ["Hello from Vercel Sandbox!"]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops sandbox when command execution fails", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const sandbox = {
      sandboxId: "sandbox_456",
      runCommand: vi.fn().mockRejectedValue(new Error("Command failed")),
      stop,
    };

    (Sandbox.create as unknown as Mock).mockResolvedValue(sandbox);

    await expect(runVercelSandboxSmokeTest()).rejects.toThrow("Command failed");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("appends auth setup guidance when token is missing", async () => {
    (Sandbox.create as unknown as Mock).mockRejectedValue(new Error("Missing OIDC token"));

    await expect(runVercelSandboxSmokeTest()).rejects.toThrow(
      "Run `vercel link` in this repo, then run `vercel env pull`."
    );
  });
});
