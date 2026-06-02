/**
 * Smoke tests for GitopsManager dispatch + error wrapping. Heavy provider
 * behaviour is covered in the per-provider test suites.
 */
import { describe, expect, test } from "bun:test";

import { GitOpsError } from "../src/errors.js";
import { GitopsManager } from "../src/manager.js";
import type {
  AuthInput,
  AuthValidation,
  GitOpsProvider,
  NormalisedRepo,
  RepoPage,
} from "../src/types.js";

function makeStubProvider(name: GitOpsProvider["name"]): GitOpsProvider {
  return {
    name,
    saveCredentials: async (_i: AuthInput) => undefined,
    validateCredentials: async (): Promise<AuthValidation> => ({
      ok: true,
      account: `${name}-acct`,
      scopes: ["repo"],
    }),
    rotateCredentials: async (_i: AuthInput): Promise<AuthValidation> => ({
      ok: true,
    }),
    revokeCredentials: async () => undefined,
    healthCheck: async () => ({ ok: true, message: "stub" }),
    listRepos: async (): Promise<RepoPage> => ({
      items: [
        {
          fqn: "org/example",
          provider: name,
          visibility: "private",
          defaultBranch: "main",
          isArchived: false,
          isFork: false,
          url: "https://example.invalid/org/example",
          createdAt: "2026-05-27T00:00:00Z",
          updatedAt: "2026-05-27T00:00:00Z",
        } satisfies NormalisedRepo,
      ],
    }),
    getRepo: async (fqn) => ({
      fqn,
      provider: name,
      visibility: "private",
      defaultBranch: "main",
      isArchived: false,
      isFork: false,
      url: `https://example.invalid/${fqn}`,
      createdAt: "2026-05-27T00:00:00Z",
      updatedAt: "2026-05-27T00:00:00Z",
    }),
    listBranches: async () => [
      { name: "main", isProtected: true, lastCommitSha: "deadbeef" },
    ],
    listLanguages: async () => ({ TypeScript: 1024 }),
    listContributors: async () => [{ login: "alice", contributions: 12 }],
    listPullRequests: async () => [],
    getPullRequest: async (_fqn, n) => ({
      id: String(n),
      number: n,
      title: "stub",
      state: "open",
      isDraft: false,
      author: "alice",
      reviewers: [],
      createdAt: "2026-05-27T00:00:00Z",
      updatedAt: "2026-05-27T00:00:00Z",
      url: "",
      labels: [],
    }),
    pullRequestAnalytics: async () => ({
      slowest: [],
      fastest: [],
      medianAgeHours: 0,
      awaitingReview: [],
      awaitingApproval: [],
    }),
    listIssues: async () => [],
    labelStats: async () => ({}),
    listPipelines: async () => [],
    listRecentRuns: async () => [],
    getRun: async (_fqn, id) => ({
      id,
      pipelineName: "ci",
      branch: "main",
      status: "completed",
      conclusion: "success",
      url: "",
      actor: "alice",
    }),
    pipelineAnalytics: async () => ({
      successRate: 1,
      durationP50: 60,
      durationP95: 180,
      slowest: [],
      fastest: [],
      running: [],
      queued: [],
      pendingApproval: [],
      totalRunsLast30Days: 0,
    }),
    listSecurityAlerts: async () => [],
    orgRollup: async () => ({
      totalRepos: 0,
      byVisibility: { public: 0, private: 0, internal: 0 },
      byLanguage: {},
      archived: 0,
      stale30d: 0,
      totalOpenPRs: 0,
      totalOpenIssues: 0,
    }),
  };
}

function makeStubHost(
  providers: Record<string, GitOpsProvider>,
  defaultName?: string,
) {
  return {
    serviceRegistry: {
      getProviderByName: <T>(_type: string, name: string) =>
        providers[name] as unknown as T | undefined,
      listProvidersForType: (_type: string) =>
        Object.keys(providers).map((n) => ({
          pluginName: n,
          isDefault: n === defaultName,
        })),
    },
  };
}

describe("GitopsManager", () => {
  test("listProviders reflects registered providers", async () => {
    const m = new GitopsManager();
    m.init(
      makeStubHost(
        {
          "gitops-github": makeStubProvider("github"),
          "gitops-gitlab": makeStubProvider("gitlab"),
        },
        "gitops-github",
      ) as never,
    );
    const snap = await m.listProviders();
    expect(snap.length).toBe(2);
    expect(snap.find((s) => s.name === "github")?.isDefault).toBe(true);
    expect(snap.every((s) => s.registered)).toBe(true);
  });

  test("dispatch to named provider", async () => {
    const m = new GitopsManager();
    const gh = makeStubProvider("github");
    m.init(
      makeStubHost(
        { "gitops-github": gh, "gitops-gitlab": makeStubProvider("gitlab") },
        "gitops-github",
      ) as never,
    );
    const page = await m.listRepos("gitops-github", { limit: 10 });
    expect(page.items.length).toBe(1);
    expect(page.items[0]?.provider).toBe("github");
  });

  test("unknown provider throws NOT_FOUND", async () => {
    const m = new GitopsManager();
    m.init(
      makeStubHost(
        { "gitops-github": makeStubProvider("github") },
        "gitops-github",
      ) as never,
    );
    await expect(m.listRepos("gitops-azdevops", {})).rejects.toBeInstanceOf(
      GitOpsError,
    );
  });
});

// ── On-demand provider install ────────────────────────────────────────────
//
// Opt-in gitops providers are NOT auto-provisioned at boot (none declare
// `defaultOn`), so the first time an operator connects one it isn't in the
// registry. `ensureProvider` must transparently install + load it.

const GITOPS_REFS = [
  {
    packageName: "@vibecontrols/vibe-plugin-gitops-github",
    pluginName: "gitops-github",
  },
] as const;

function makeInstallableHost(opts: {
  initial?: Record<string, GitOpsProvider>;
  /** Provider that becomes registered once `loadProvider(packageName)` runs. */
  registerOnLoad?: {
    packageName: string;
    name: string;
    provider: GitOpsProvider;
  };
}) {
  const providers: Record<string, GitOpsProvider> = { ...(opts.initial ?? {}) };
  const calls = { install: [] as string[], loadProvider: [] as string[] };
  const host = {
    serviceRegistry: {
      getProviderByName: <T>(_type: string, name: string) =>
        providers[name] as unknown as T | undefined,
      listProvidersForType: (_type: string) =>
        Object.keys(providers).map((n) => ({
          pluginName: n,
          isDefault: false,
        })),
      setProviderDefault: () => undefined,
    },
    plugins: {
      skipInstall: () => false,
      install: async (pkg: string) => {
        calls.install.push(pkg);
      },
      loadProvider: async (pkg: string) => {
        calls.loadProvider.push(pkg);
        if (opts.registerOnLoad && pkg === opts.registerOnLoad.packageName) {
          providers[opts.registerOnLoad.name] = opts.registerOnLoad.provider;
        }
      },
      runPrereqs: async () => undefined,
    },
  };
  return { host, calls, providers };
}

const PAT: AuthInput = { kind: "pat", token: "ghp_test" };

describe("GitopsManager on-demand provider install", () => {
  test("saveCredentials installs an opt-in provider that isn't registered", async () => {
    const gh = makeStubProvider("github");
    const { host, calls, providers } = makeInstallableHost({
      registerOnLoad: {
        packageName: "@vibecontrols/vibe-plugin-gitops-github",
        name: "github",
        provider: gh,
      },
    });
    const m = new GitopsManager();
    m.init(host as never, GITOPS_REFS as never);

    expect(providers["github"]).toBeUndefined();
    await m.saveCredentials("github", PAT);

    expect(calls.install).toContain("@vibecontrols/vibe-plugin-gitops-github");
    expect(calls.loadProvider).toContain(
      "@vibecontrols/vibe-plugin-gitops-github",
    );
    expect(providers["github"]).toBe(gh);
  });

  test("saveCredentials does NOT reinstall an already-registered provider", async () => {
    const gh = makeStubProvider("github");
    const { host, calls } = makeInstallableHost({ initial: { github: gh } });
    const m = new GitopsManager();
    m.init(host as never, GITOPS_REFS as never);

    await m.saveCredentials("github", PAT);
    expect(calls.install).toEqual([]);
    expect(calls.loadProvider).toEqual([]);
  });

  test("setActiveProvider installs the provider on demand", async () => {
    const gl = makeStubProvider("github");
    const refs = [
      {
        packageName: "@vibecontrols/vibe-plugin-gitops-gitlab",
        pluginName: "gitops-gitlab",
      },
    ];
    const { host, calls } = makeInstallableHost({
      registerOnLoad: {
        packageName: "@vibecontrols/vibe-plugin-gitops-gitlab",
        name: "gitlab",
        provider: gl,
      },
    });
    const m = new GitopsManager();
    m.init(host as never, refs as never);

    await m.setActiveProvider("gitlab");
    expect(calls.loadProvider).toContain(
      "@vibecontrols/vibe-plugin-gitops-gitlab",
    );
  });

  test("unknown provider (not in refs) throws NOT_FOUND without installing", async () => {
    const { host, calls } = makeInstallableHost({});
    const m = new GitopsManager();
    m.init(host as never, GITOPS_REFS as never);

    await expect(m.saveCredentials("bogus", PAT)).rejects.toBeInstanceOf(
      GitOpsError,
    );
    expect(calls.install).toEqual([]);
  });

  test("install that never registers the provider throws NOT_FOUND", async () => {
    // loadProvider runs but doesn't add "github" to the registry.
    const { host } = makeInstallableHost({});
    const m = new GitopsManager();
    m.init(host as never, GITOPS_REFS as never);

    await expect(m.saveCredentials("github", PAT)).rejects.toBeInstanceOf(
      GitOpsError,
    );
  });
});
