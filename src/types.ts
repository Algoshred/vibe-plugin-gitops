/**
 * GitOps provider contract.
 *
 * Provider plugins (`@vibecontrols/vibe-plugin-gitops-github`, `-gitlab`,
 * `-bitbucket`, `-azdevops`) implement this interface and register
 * themselves under type `"gitops"` in the agent's service registry.
 *
 * Every provider returns the same normalised shapes so the consumer (UI,
 * CLI) can render data without switching on provider name.
 */

export type GitVisibility = "public" | "private" | "internal";

/** "owner/repo" (GitHub, Bitbucket) or "group/sub/project" (GitLab, AzDO). */
export type RepoFqn = string;

export interface NormalisedRepo {
  fqn: RepoFqn;
  provider: string;
  visibility: GitVisibility;
  defaultBranch: string;
  description?: string;
  language?: string;
  topics?: string[];
  isArchived: boolean;
  isFork: boolean;
  size?: number;
  stars?: number;
  forks?: number;
  watchers?: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  pushedAt?: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  author: string;
  reviewers: string[];
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
  mergeState?: "clean" | "dirty" | "blocked" | "unstable" | "behind";
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  durationOpenSeconds?: number;
  url: string;
  labels: string[];
}

export interface Pipeline {
  id: string;
  name: string;
  state: "active" | "disabled";
  path?: string;
}

export interface PipelineJob {
  id: string;
  name: string;
  status: string;
  conclusion?: string;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
}

export interface PipelineRun {
  id: string;
  pipelineName: string;
  branch: string;
  status: "queued" | "running" | "completed" | "waiting";
  conclusion?:
    | "success"
    | "failure"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "neutral";
  event?: string;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  url: string;
  actor: string;
  jobs?: PipelineJob[];
  commitSha?: string;
  commitMessage?: string;
}

export interface SecurityAlert {
  id: string;
  type: "code-scan" | "secret-scan" | "dependency" | "advisory";
  severity: "critical" | "high" | "medium" | "low" | "info";
  state: "open" | "dismissed" | "fixed";
  title: string;
  url: string;
  ruleId?: string;
  ecosystem?: string;
  cve?: string;
  createdAt: string;
}

export interface OrgRollup {
  totalRepos: number;
  byVisibility: Record<GitVisibility, number>;
  byLanguage: Record<string, number>;
  archived: number;
  stale30d: number;
  totalOpenPRs: number;
  totalOpenIssues: number;
}

export interface AuthInput {
  kind: "pat" | "oauth" | "app";
  token: string;
  meta?: Record<string, string>;
}

export interface AuthValidation {
  ok: boolean;
  account?: string;
  scopes?: string[];
  expiresAt?: string;
  message?: string;
}

export interface HealthSnapshot {
  ok: boolean;
  rateLimit?: { remaining: number; resetAt: string };
  message?: string;
}

export interface RepoPage {
  items: NormalisedRepo[];
  nextCursor?: string;
}

export interface PullRequestAnalytics {
  slowest: PullRequest[];
  fastest: PullRequest[];
  medianAgeHours: number;
  awaitingReview: PullRequest[];
  awaitingApproval: PullRequest[];
}

export interface PipelineAnalytics {
  successRate: number;
  durationP50: number;
  durationP95: number;
  slowest: PipelineRun[];
  fastest: PipelineRun[];
  running: PipelineRun[];
  queued: PipelineRun[];
  pendingApproval: PipelineRun[];
  totalRunsLast30Days: number;
}

export interface Branch {
  name: string;
  isProtected: boolean;
  lastCommitSha: string;
}

export interface Contributor {
  login: string;
  contributions: number;
  avatarUrl?: string;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
  createdAt: string;
}

export interface Environment {
  name: string;
  state: string;
  lastDeployedAt?: string;
  url?: string;
}

export interface Deployment {
  id: string;
  env: string;
  ref: string;
  state: string;
  createdAt: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

export interface GitOpsProvider {
  readonly name: "github" | "gitlab" | "bitbucket" | "azdevops";

  // ── token lifecycle ──
  saveCredentials(input: AuthInput): Promise<void>;
  validateCredentials(): Promise<AuthValidation>;
  rotateCredentials(input: AuthInput): Promise<AuthValidation>;
  revokeCredentials(): Promise<void>;
  healthCheck(): Promise<HealthSnapshot>;

  // ── repos ──
  listRepos(opts: {
    org?: string;
    limit?: number;
    cursor?: string;
  }): Promise<RepoPage>;
  getRepo(fqn: RepoFqn): Promise<NormalisedRepo>;
  listBranches(fqn: RepoFqn): Promise<Branch[]>;
  listLanguages(fqn: RepoFqn): Promise<Record<string, number>>;
  listContributors(
    fqn: RepoFqn,
    opts?: { limit?: number },
  ): Promise<Contributor[]>;

  // ── PR/MR ──
  listPullRequests(
    fqn: RepoFqn,
    opts?: { state?: "open" | "closed" | "all"; limit?: number },
  ): Promise<PullRequest[]>;
  getPullRequest(fqn: RepoFqn, id: number): Promise<PullRequest>;
  pullRequestAnalytics(fqn: RepoFqn): Promise<PullRequestAnalytics>;

  // ── issues ──
  listIssues(
    fqn: RepoFqn,
    opts?: { state?: "open" | "closed"; limit?: number },
  ): Promise<IssueSummary[]>;
  labelStats(fqn: RepoFqn): Promise<Record<string, number>>;

  // ── CI/CD ──
  listPipelines(fqn: RepoFqn): Promise<Pipeline[]>;
  listRecentRuns(
    fqn: RepoFqn,
    opts?: { limit?: number; branch?: string },
  ): Promise<PipelineRun[]>;
  getRun(fqn: RepoFqn, runId: string): Promise<PipelineRun>;
  pipelineAnalytics(fqn: RepoFqn): Promise<PipelineAnalytics>;

  // ── environments / deployments (optional per provider) ──
  listEnvironments?(fqn: RepoFqn): Promise<Environment[]>;
  listDeployments?(fqn: RepoFqn, env?: string): Promise<Deployment[]>;

  // ── security ──
  listSecurityAlerts(
    fqn: RepoFqn,
    opts?: { kind?: SecurityAlert["type"] },
  ): Promise<SecurityAlert[]>;

  // ── org/group rollup ──
  orgRollup(org: string): Promise<OrgRollup>;

  // ── webhooks (optional) ──
  listWebhooks?(fqn: RepoFqn): Promise<Webhook[]>;
}

/**
 * Service-registry surface the manager talks to. The agent's runtime
 * registry exposes richer shape than the SDK's neutral one; we narrow
 * structurally to avoid a hard dependency on the agent package.
 */
export interface GitOpsServiceRegistry {
  getProviderByName<T>(type: string, name: string): T | undefined;
  listProvidersForType(
    type: string,
  ): Array<{ pluginName: string; isDefault: boolean }>;
  setProviderDefault?(type: string, name: string): void;
}

export const DEFAULT_PROVIDER_CONFIG_KEY = "provider:default:gitops";
