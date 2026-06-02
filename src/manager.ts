/**
 * GitopsManager — facade over registered GitOps providers.
 *
 * Looks up concrete providers in the agent's service registry by name and
 * dispatches each operation to the selected provider. Falls back to the
 * configured default provider when no explicit name is given. Mirrors the
 * shape of TunnelManager in vibe-plugin-tunnel.
 */

import { BoundLogger } from "@vibecontrols/plugin-sdk";
import type {
  HostServices,
  MetaProviderRef,
} from "@vibecontrols/plugin-sdk/contract";

import {
  DEFAULT_PROVIDER_CONFIG_KEY,
  type AuthInput,
  type AuthValidation,
  type Branch,
  type Contributor,
  type Deployment,
  type Environment,
  type GitOpsProvider,
  type GitOpsServiceRegistry,
  type HealthSnapshot,
  type IssueSummary,
  type NormalisedRepo,
  type OrgRollup,
  type Pipeline,
  type PipelineAnalytics,
  type PipelineRun,
  type PullRequest,
  type PullRequestAnalytics,
  type RepoFqn,
  type RepoPage,
  type SecurityAlert,
  type Webhook,
} from "./types.js";
import { GitOpsError } from "./errors.js";

const LOG_SOURCE = "gitops-manager";

/**
 * Map a provider PACKAGE ref to the NAME it registers under in the service
 * registry. The provider plugins follow the `gitops-<name>` plugin-name
 * convention (e.g. `gitops-github`) and register their provider as `<name>`
 * (e.g. `github`), so we strip the `gitops-` prefix. Falls back to deriving
 * the name from the package's `vibe-plugin-gitops-<name>` suffix.
 */
function providerNameFromRef(ref: MetaProviderRef): string {
  if (ref.pluginName) return ref.pluginName.replace(/^gitops-/, "");
  return ref.packageName.replace(/^.*vibe-plugin-gitops-/, "");
}

export interface ProviderSnapshot {
  name: string;
  isDefault: boolean;
  registered: boolean;
  authenticated: boolean;
  health: HealthSnapshot;
}

export class GitopsManager {
  private registry?: GitOpsServiceRegistry;
  private host?: HostServices;
  private log: BoundLogger = new BoundLogger(undefined, LOG_SOURCE);
  /**
   * Known provider package refs (github/gitlab/bitbucket/azdevops), passed in
   * from the meta plugin's `GITOPS_PROVIDERS`. Used to install a provider on
   * demand when the operator connects it but it was skipped at boot (opt-in
   * providers are NOT auto-provisioned to keep the agent lean).
   */
  private providerRefs: ReadonlyArray<MetaProviderRef> = [];

  init(
    host: HostServices,
    providerRefs?: ReadonlyArray<MetaProviderRef>,
  ): void {
    this.host = host;
    this.registry = host.serviceRegistry as unknown as
      | GitOpsServiceRegistry
      | undefined;
    this.providerRefs = providerRefs ?? [];
    this.log = new BoundLogger(host.logger, LOG_SOURCE);
    this.log.info("GitOps manager initialised");
  }

  /**
   * Resolve a provider, installing it on demand if it is a known opt-in
   * provider that is not registered yet.
   *
   * `provisionMetaProviders` deliberately SKIPS opt-in providers at boot (none
   * of the gitops providers declare `defaultOn`, so the agent stays lean and
   * doesn't pull all four SCM integrations). That means the FIRST time an
   * operator connects a provider via the GitOps tab (`saveCredentials` /
   * `setActiveProvider`), it isn't in the service registry yet and a plain
   * lookup throws `NOT_FOUND`. Rather than surface that to the user, we
   * transparently run the same install → load → prereqs sequence
   * `provisionMetaProviders` would have, then re-resolve — "behind the scenes".
   *
   * The install is one-time: once loaded, the provider plugin is persisted to
   * the agent's plugin manifest and re-registers on every subsequent boot, so
   * later calls hit the fast `getProviderByName` path. Unknown provider names
   * (not in `providerRefs`) still throw `NOT_FOUND`.
   */
  private async ensureProvider(name: string): Promise<GitOpsProvider> {
    const wanted = name.trim();
    if (!this.registry) {
      throw new GitOpsError("UPSTREAM", "Service registry not available");
    }
    const existing = this.registry.getProviderByName<GitOpsProvider>(
      "gitops",
      wanted,
    );
    if (existing) return existing;

    const ref = this.providerRefs.find(
      (r) => providerNameFromRef(r) === wanted,
    );
    if (!ref) {
      throw new GitOpsError(
        "NOT_FOUND",
        `Gitops provider '${wanted}' is not registered`,
      );
    }
    const plugins = this.host?.plugins;
    if (!plugins?.loadProvider) {
      throw new GitOpsError(
        "NOT_FOUND",
        `Gitops provider '${wanted}' is not registered (plugin host unavailable for on-demand install)`,
      );
    }

    this.log.info(
      `On-demand installing gitops provider '${wanted}' (${ref.packageName})`,
    );
    const skip = plugins.skipInstall?.() ?? false;
    try {
      if (!skip)
        await plugins.install?.(ref.packageName, { refreshLatest: true });
      await plugins.loadProvider(ref.packageName);
      await plugins.runPrereqs?.(ref.packageName, { skipInstall: skip });
    } catch (err) {
      throw new GitOpsError(
        "UPSTREAM",
        `Failed to install gitops provider '${wanted}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const installed = this.registry.getProviderByName<GitOpsProvider>(
      "gitops",
      wanted,
    );
    if (!installed) {
      throw new GitOpsError(
        "NOT_FOUND",
        `Gitops provider '${wanted}' did not register after on-demand install`,
      );
    }
    return installed;
  }

  // ── Provider resolution ─────────────────────────────────────────────

  private resolveProvider(name?: string): GitOpsProvider {
    if (!this.registry) {
      throw new GitOpsError("UPSTREAM", "Service registry not available");
    }
    const explicit = name?.trim();
    if (explicit) {
      const p = this.registry.getProviderByName<GitOpsProvider>(
        "gitops",
        explicit,
      );
      if (!p)
        throw new GitOpsError(
          "NOT_FOUND",
          `Gitops provider '${explicit}' is not registered`,
        );
      return p;
    }
    const fallback = this.defaultProviderNameSync();
    if (!fallback)
      throw new GitOpsError(
        "INVALID",
        "No default gitops provider configured and none specified",
      );
    const p = this.registry.getProviderByName<GitOpsProvider>(
      "gitops",
      fallback,
    );
    if (!p)
      throw new GitOpsError(
        "NOT_FOUND",
        `Default gitops provider '${fallback}' is not registered`,
      );
    return p;
  }

  private defaultProviderNameSync(): string | undefined {
    const entries = this.registry?.listProvidersForType("gitops") ?? [];
    const flagged = entries.find((e) => e.isDefault);
    if (flagged) return flagged.pluginName;
    if (entries.length === 1) return entries[0]!.pluginName;
    return undefined;
  }

  private async defaultProviderName(): Promise<string | undefined> {
    const fromConfig = await this.host?.getConfig?.(
      DEFAULT_PROVIDER_CONFIG_KEY,
    );
    if (fromConfig) return fromConfig;
    return this.defaultProviderNameSync();
  }

  private listProviderEntries(): Array<{
    pluginName: string;
    isDefault: boolean;
  }> {
    return this.registry?.listProvidersForType("gitops") ?? [];
  }

  // ── Meta-level operations ───────────────────────────────────────────

  async listProviders(): Promise<ProviderSnapshot[]> {
    const entries = this.listProviderEntries();
    const out: ProviderSnapshot[] = [];
    for (const entry of entries) {
      const p = this.registry?.getProviderByName<GitOpsProvider>(
        "gitops",
        entry.pluginName,
      );
      if (!p) {
        out.push({
          name: entry.pluginName,
          isDefault: entry.isDefault,
          registered: false,
          authenticated: false,
          health: { ok: false, message: "unavailable" },
        });
        continue;
      }
      let health: HealthSnapshot;
      try {
        health = await p.healthCheck();
      } catch (err) {
        health = {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
      let authed = false;
      try {
        const v = await p.validateCredentials();
        authed = v.ok;
      } catch {
        // ignore — already false
      }
      out.push({
        name: entry.pluginName.replace(/^gitops-/, ""),
        isDefault: entry.isDefault,
        registered: true,
        authenticated: authed,
        health,
      });
    }
    return out;
  }

  async getActiveProvider(): Promise<{ name: string | undefined }> {
    return { name: await this.defaultProviderName() };
  }

  async setActiveProvider(name: string): Promise<void> {
    // Install on demand + validate the provider exists.
    await this.ensureProvider(name);
    if (this.registry?.setProviderDefault) {
      this.registry.setProviderDefault("gitops", name);
    }
    const hostWithSetConfig = this.host as
      | (HostServices & {
          setConfig?: (key: string, value: string) => Promise<void>;
        })
      | undefined;
    if (hostWithSetConfig?.setConfig) {
      await hostWithSetConfig.setConfig(DEFAULT_PROVIDER_CONFIG_KEY, name);
    }
    this.log.info(`Default gitops provider set to ${name}`);
  }

  // ── Dispatch helpers (one per GitOpsProvider method) ────────────────

  async saveCredentials(provider: string, input: AuthInput): Promise<void> {
    // Connecting a provider is the canonical "on demand" trigger: install the
    // opt-in provider plugin if it isn't registered yet, then save creds.
    await (await this.ensureProvider(provider)).saveCredentials(input);
  }

  async validateCredentials(provider: string): Promise<AuthValidation> {
    return this.resolveProvider(provider).validateCredentials();
  }

  async rotateCredentials(
    provider: string,
    input: AuthInput,
  ): Promise<AuthValidation> {
    return this.resolveProvider(provider).rotateCredentials(input);
  }

  async revokeCredentials(provider: string): Promise<void> {
    await this.resolveProvider(provider).revokeCredentials();
  }

  async healthCheck(provider: string): Promise<HealthSnapshot> {
    return this.resolveProvider(provider).healthCheck();
  }

  async listRepos(
    provider: string,
    opts: { org?: string; limit?: number; cursor?: string },
  ): Promise<RepoPage> {
    return this.resolveProvider(provider).listRepos(opts);
  }

  async getRepo(provider: string, fqn: RepoFqn): Promise<NormalisedRepo> {
    return this.resolveProvider(provider).getRepo(fqn);
  }

  async listBranches(provider: string, fqn: RepoFqn): Promise<Branch[]> {
    return this.resolveProvider(provider).listBranches(fqn);
  }

  async listLanguages(
    provider: string,
    fqn: RepoFqn,
  ): Promise<Record<string, number>> {
    return this.resolveProvider(provider).listLanguages(fqn);
  }

  async listContributors(
    provider: string,
    fqn: RepoFqn,
    opts?: { limit?: number },
  ): Promise<Contributor[]> {
    return this.resolveProvider(provider).listContributors(fqn, opts);
  }

  async listPullRequests(
    provider: string,
    fqn: RepoFqn,
    opts?: { state?: "open" | "closed" | "all"; limit?: number },
  ): Promise<PullRequest[]> {
    return this.resolveProvider(provider).listPullRequests(fqn, opts);
  }

  async getPullRequest(
    provider: string,
    fqn: RepoFqn,
    id: number,
  ): Promise<PullRequest> {
    return this.resolveProvider(provider).getPullRequest(fqn, id);
  }

  async pullRequestAnalytics(
    provider: string,
    fqn: RepoFqn,
  ): Promise<PullRequestAnalytics> {
    return this.resolveProvider(provider).pullRequestAnalytics(fqn);
  }

  async listIssues(
    provider: string,
    fqn: RepoFqn,
    opts?: { state?: "open" | "closed"; limit?: number },
  ): Promise<IssueSummary[]> {
    return this.resolveProvider(provider).listIssues(fqn, opts);
  }

  async labelStats(
    provider: string,
    fqn: RepoFqn,
  ): Promise<Record<string, number>> {
    return this.resolveProvider(provider).labelStats(fqn);
  }

  async listPipelines(provider: string, fqn: RepoFqn): Promise<Pipeline[]> {
    return this.resolveProvider(provider).listPipelines(fqn);
  }

  async listRecentRuns(
    provider: string,
    fqn: RepoFqn,
    opts?: { limit?: number; branch?: string },
  ): Promise<PipelineRun[]> {
    return this.resolveProvider(provider).listRecentRuns(fqn, opts);
  }

  async getRun(
    provider: string,
    fqn: RepoFqn,
    runId: string,
  ): Promise<PipelineRun> {
    return this.resolveProvider(provider).getRun(fqn, runId);
  }

  async pipelineAnalytics(
    provider: string,
    fqn: RepoFqn,
  ): Promise<PipelineAnalytics> {
    return this.resolveProvider(provider).pipelineAnalytics(fqn);
  }

  async listEnvironments(
    provider: string,
    fqn: RepoFqn,
  ): Promise<Environment[]> {
    const p = this.resolveProvider(provider);
    return p.listEnvironments?.(fqn) ?? [];
  }

  async listDeployments(
    provider: string,
    fqn: RepoFqn,
    env?: string,
  ): Promise<Deployment[]> {
    const p = this.resolveProvider(provider);
    return p.listDeployments?.(fqn, env) ?? [];
  }

  async listSecurityAlerts(
    provider: string,
    fqn: RepoFqn,
    opts?: { kind?: SecurityAlert["type"] },
  ): Promise<SecurityAlert[]> {
    return this.resolveProvider(provider).listSecurityAlerts(fqn, opts);
  }

  async orgRollup(provider: string, org: string): Promise<OrgRollup> {
    return this.resolveProvider(provider).orgRollup(org);
  }

  async listWebhooks(provider: string, fqn: RepoFqn): Promise<Webhook[]> {
    const p = this.resolveProvider(provider);
    return p.listWebhooks?.(fqn) ?? [];
  }
}
