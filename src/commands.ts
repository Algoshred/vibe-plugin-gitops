/**
 * CLI surface for `vibe gitops`. Calls the local agent REST API so the
 * flow works whether the agent is in-process or on localhost.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { HostServices } from "@vibecontrols/plugin-sdk/contract";

const DEFAULT_AGENT_URL = "http://localhost:3005";

function agentBaseUrl(): string {
  return process.env.AGENT_BASE_URL ?? DEFAULT_AGENT_URL;
}

function authHeaders(): Record<string, string> {
  const fromEnv = process.env.AGENT_API_KEY ?? process.env.X_AGENT_API_KEY;
  if (fromEnv) return { "x-agent-api-key": fromEnv };
  try {
    const dir =
      process.env.VIBECONTROLS_HOME ??
      join(process.cwd(), ".boff", "vibecontrols");
    const configPath = join(
      resolve(dir),
      "agents",
      process.env.VIBECONTROLS_PROFILE ?? "default",
      "config.json",
    );
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as {
        "static-api-key"?: string;
      };
      if (cfg["static-api-key"])
        return { "x-agent-api-key": cfg["static-api-key"] };
    }
  } catch {
    // best-effort; caller will see 401
  }
  return {};
}

async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${agentBaseUrl()}/api/gitops${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${agentBaseUrl()}/api/gitops${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

interface CommanderLike {
  command(name: string): CommanderLike;
  description(text: string): CommanderLike;
  option(flag: string, description?: string): CommanderLike;
  action<H extends (...args: never[]) => unknown>(handler: H): CommanderLike;
}

export function registerGitopsCommands(
  program: CommanderLike,
  _hostServices: HostServices,
): void {
  const cmd = program
    .command("gitops")
    .description(
      "Manage GitOps across providers (GitHub, GitLab, Bitbucket, AzDO)",
    );

  // providers
  const providersCmd = cmd
    .command("providers")
    .description("Manage GitOps providers");

  providersCmd
    .command("ls")
    .description("List registered providers and their auth state")
    .action(async () => {
      const data = await apiGet<{
        providers: Array<{
          name: string;
          isDefault: boolean;
          registered: boolean;
          authenticated: boolean;
          health: { ok: boolean; message?: string };
        }>;
      }>("/providers");
      for (const p of data.providers) {
        const star = p.isDefault ? "* " : "  ";
        const auth = p.authenticated ? "authed" : "no-auth";
        const ok = p.health.ok ? "ok" : `error (${p.health.message ?? ""})`;
        console.log(`${star}${p.name}\t[${auth}, ${ok}]`);
      }
    });

  providersCmd
    .command("set-default <name>")
    .description("Set the active provider")
    .action(async (name: string) => {
      const res = await apiPost("/providers/active", { provider: name });
      console.log(JSON.stringify(res, null, 2));
    });

  // auth
  const authCmd = cmd
    .command("auth")
    .description("Manage provider credentials");

  authCmd
    .command("set <provider> <token>")
    .description("Save a PAT for the named provider")
    .action(async (provider: string, token: string) => {
      const res = await apiPost(`/${provider}/auth`, { kind: "pat", token });
      console.log(JSON.stringify(res, null, 2));
    });

  authCmd
    .command("validate <provider>")
    .description("Validate stored credentials")
    .action(async (provider: string) => {
      const res = await apiGet(`/${provider}/auth/validate`);
      console.log(JSON.stringify(res, null, 2));
    });

  authCmd
    .command("revoke <provider>")
    .description("Delete stored credentials")
    .action(async (provider: string) => {
      const res = await fetch(`${agentBaseUrl()}/api/gitops/${provider}/auth`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      console.log(`status=${res.status}`);
    });

  // repos
  cmd
    .command("repos <provider>")
    .description("List repos for the named provider")
    .option("--org <name>", "Org / group / workspace name")
    .option("--limit <n>", "Maximum repos to fetch (default 30)")
    .action(
      async (provider: string, opts: { org?: string; limit?: string }) => {
        const qs = new URLSearchParams();
        if (opts.org) qs.set("org", opts.org);
        if (opts.limit) qs.set("limit", String(opts.limit));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        const data = await apiGet<{
          items: Array<{ fqn: string; visibility: string; updatedAt: string }>;
        }>(`/${provider}/repos${suffix}`);
        for (const r of data.items) {
          console.log(`${r.fqn}\t${r.visibility}\t${r.updatedAt}`);
        }
      },
    );

  // runs
  cmd
    .command("runs <provider> <fqn>")
    .description("List recent CI runs for a repo")
    .option("--branch <name>", "Limit to a branch")
    .option("--limit <n>", "Maximum runs to fetch (default 20)")
    .action(
      async (
        provider: string,
        fqn: string,
        opts: { branch?: string; limit?: string },
      ) => {
        const qs = new URLSearchParams();
        if (opts.branch) qs.set("branch", opts.branch);
        if (opts.limit) qs.set("limit", String(opts.limit));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        const data = await apiGet<
          Array<{
            id: string;
            pipelineName: string;
            status: string;
            conclusion?: string;
            durationSeconds?: number;
            url: string;
          }>
        >(`/${provider}/repos/${encodeURIComponent(fqn)}/runs${suffix}`);
        for (const r of data) {
          const dur = r.durationSeconds ? `${r.durationSeconds}s` : "-";
          console.log(
            `${r.id}\t${r.pipelineName}\t${r.status}\t${r.conclusion ?? ""}\t${dur}\t${r.url}`,
          );
        }
      },
    );

  // analytics
  cmd
    .command("analytics <provider> <fqn>")
    .description("Pipeline duration + success-rate analytics for a repo")
    .action(async (provider: string, fqn: string) => {
      const data = await apiGet(
        `/${provider}/repos/${encodeURIComponent(fqn)}/pipelines/analytics`,
      );
      console.log(JSON.stringify(data, null, 2));
    });

  // doctor
  cmd
    .command("doctor")
    .description("Provider health summary")
    .action(async () => {
      const data = await apiGet<{
        providers: Array<{
          name: string;
          health: { ok: boolean; message?: string };
        }>;
      }>("/providers");
      for (const p of data.providers) {
        console.log(
          `${p.name}: ${p.health.ok ? "ok" : `fail - ${p.health.message ?? "?"}`}`,
        );
      }
    });
}
