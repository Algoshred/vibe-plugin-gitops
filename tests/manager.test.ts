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
