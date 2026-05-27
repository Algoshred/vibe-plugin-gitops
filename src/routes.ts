/**
 * HTTP routes for the GitOps meta plugin. Mounted at /api/gitops.
 *
 * Routing strategy: path-prefix `/api/gitops/:provider/<resource>`. The
 * provider parameter is matched to a name in the agent's service registry
 * under type "gitops". Routes without :provider use the active provider.
 */
import { Elysia, t } from "elysia";

import { GitOpsError, httpStatusForCode } from "./errors.js";
import type { GitopsManager } from "./manager.js";

function decodeFqn(raw: string): string {
  // Accept either URL-encoded "owner/repo" or base64url-encoded form.
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.includes("/")) return decoded;
  } catch {
    // ignore
  }
  // base64url decode (replace - / _ → + / before atob).
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    return atob(padded);
  } catch {
    return raw;
  }
}

function err(set: { status?: number | string }, e: unknown): unknown {
  const g = GitOpsError.fromUnknown(e);
  set.status = httpStatusForCode(g.code);
  return g.toJSON();
}

export function createGitopsManagerRoutes(manager: GitopsManager) {
  return (
    new Elysia()
      // ── meta-level ────────────────────────────────────────────────
      .get("/providers", async ({ set }) => {
        try {
          const providers = await manager.listProviders();
          return { providers };
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/providers/active", async ({ set }) => {
        try {
          return await manager.getActiveProvider();
        } catch (e) {
          return err(set, e);
        }
      })
      .post(
        "/providers/active",
        async ({ body, set }) => {
          try {
            await manager.setActiveProvider(body.provider);
            return { success: true, provider: body.provider };
          } catch (e) {
            return err(set, e);
          }
        },
        { body: t.Object({ provider: t.String() }) },
      )

      // ── per-provider auth ─────────────────────────────────────────
      .post(
        "/:provider/auth",
        async ({ params, body, set }) => {
          try {
            await manager.saveCredentials(params.provider, body);
            const validation = await manager.validateCredentials(
              params.provider,
            );
            if (!validation.ok) set.status = 400;
            return validation;
          } catch (e) {
            return err(set, e);
          }
        },
        {
          body: t.Object({
            kind: t.Union([
              t.Literal("pat"),
              t.Literal("oauth"),
              t.Literal("app"),
            ]),
            token: t.String(),
            meta: t.Optional(t.Record(t.String(), t.String())),
          }),
        },
      )
      .get("/:provider/auth/validate", async ({ params, set }) => {
        try {
          return await manager.validateCredentials(params.provider);
        } catch (e) {
          return err(set, e);
        }
      })
      .post(
        "/:provider/auth/rotate",
        async ({ params, body, set }) => {
          try {
            return await manager.rotateCredentials(params.provider, body);
          } catch (e) {
            return err(set, e);
          }
        },
        {
          body: t.Object({
            kind: t.Union([
              t.Literal("pat"),
              t.Literal("oauth"),
              t.Literal("app"),
            ]),
            token: t.String(),
            meta: t.Optional(t.Record(t.String(), t.String())),
          }),
        },
      )
      .delete("/:provider/auth", async ({ params, set }) => {
        try {
          await manager.revokeCredentials(params.provider);
          return { success: true };
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/health", async ({ params, set }) => {
        try {
          return await manager.healthCheck(params.provider);
        } catch (e) {
          return err(set, e);
        }
      })

      // ── repos ─────────────────────────────────────────────────────
      .get("/:provider/repos", async ({ params, query, set }) => {
        try {
          return await manager.listRepos(params.provider, {
            org: query["org"],
            limit: query["limit"] ? Number(query["limit"]) : undefined,
            cursor: query["cursor"],
          });
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn", async ({ params, set }) => {
        try {
          return await manager.getRepo(params.provider, decodeFqn(params.fqn));
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn/branches", async ({ params, set }) => {
        try {
          return await manager.listBranches(
            params.provider,
            decodeFqn(params.fqn),
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn/languages", async ({ params, set }) => {
        try {
          return await manager.listLanguages(
            params.provider,
            decodeFqn(params.fqn),
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get(
        "/:provider/repos/:fqn/contributors",
        async ({ params, query, set }) => {
          try {
            return await manager.listContributors(
              params.provider,
              decodeFqn(params.fqn),
              { limit: query["limit"] ? Number(query["limit"]) : undefined },
            );
          } catch (e) {
            return err(set, e);
          }
        },
      )

      // ── PRs ───────────────────────────────────────────────────────
      .get("/:provider/repos/:fqn/pulls/analytics", async ({ params, set }) => {
        try {
          return await manager.pullRequestAnalytics(
            params.provider,
            decodeFqn(params.fqn),
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn/pulls/:n", async ({ params, set }) => {
        try {
          return await manager.getPullRequest(
            params.provider,
            decodeFqn(params.fqn),
            Number(params.n),
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn/pulls", async ({ params, query, set }) => {
        try {
          const stateRaw = query["state"];
          const state =
            stateRaw === "open" || stateRaw === "closed" || stateRaw === "all"
              ? stateRaw
              : undefined;
          return await manager.listPullRequests(
            params.provider,
            decodeFqn(params.fqn),
            {
              state,
              limit: query["limit"] ? Number(query["limit"]) : undefined,
            },
          );
        } catch (e) {
          return err(set, e);
        }
      })

      // ── issues ────────────────────────────────────────────────────
      .get("/:provider/repos/:fqn/issues", async ({ params, query, set }) => {
        try {
          const stateRaw = query["state"];
          const state =
            stateRaw === "open" || stateRaw === "closed" ? stateRaw : undefined;
          return await manager.listIssues(
            params.provider,
            decodeFqn(params.fqn),
            {
              state,
              limit: query["limit"] ? Number(query["limit"]) : undefined,
            },
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn/labels", async ({ params, set }) => {
        try {
          return await manager.labelStats(
            params.provider,
            decodeFqn(params.fqn),
          );
        } catch (e) {
          return err(set, e);
        }
      })

      // ── CI/CD ─────────────────────────────────────────────────────
      .get(
        "/:provider/repos/:fqn/pipelines/analytics",
        async ({ params, set }) => {
          try {
            return await manager.pipelineAnalytics(
              params.provider,
              decodeFqn(params.fqn),
            );
          } catch (e) {
            return err(set, e);
          }
        },
      )
      .get("/:provider/repos/:fqn/pipelines", async ({ params, set }) => {
        try {
          return await manager.listPipelines(
            params.provider,
            decodeFqn(params.fqn),
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn/runs/:id", async ({ params, set }) => {
        try {
          return await manager.getRun(
            params.provider,
            decodeFqn(params.fqn),
            params.id,
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get("/:provider/repos/:fqn/runs", async ({ params, query, set }) => {
        try {
          return await manager.listRecentRuns(
            params.provider,
            decodeFqn(params.fqn),
            {
              limit: query["limit"] ? Number(query["limit"]) : undefined,
              branch: query["branch"],
            },
          );
        } catch (e) {
          return err(set, e);
        }
      })

      // ── environments / deployments ────────────────────────────────
      .get("/:provider/repos/:fqn/environments", async ({ params, set }) => {
        try {
          return await manager.listEnvironments(
            params.provider,
            decodeFqn(params.fqn),
          );
        } catch (e) {
          return err(set, e);
        }
      })
      .get(
        "/:provider/repos/:fqn/deployments",
        async ({ params, query, set }) => {
          try {
            return await manager.listDeployments(
              params.provider,
              decodeFqn(params.fqn),
              query["env"],
            );
          } catch (e) {
            return err(set, e);
          }
        },
      )

      // ── security ──────────────────────────────────────────────────
      .get(
        "/:provider/repos/:fqn/security/alerts",
        async ({ params, query, set }) => {
          try {
            const kindRaw = query["kind"];
            const kind =
              kindRaw === "code-scan" ||
              kindRaw === "secret-scan" ||
              kindRaw === "dependency" ||
              kindRaw === "advisory"
                ? kindRaw
                : undefined;
            return await manager.listSecurityAlerts(
              params.provider,
              decodeFqn(params.fqn),
              { kind },
            );
          } catch (e) {
            return err(set, e);
          }
        },
      )

      // ── org rollup ────────────────────────────────────────────────
      .get("/:provider/orgs/:org/rollup", async ({ params, set }) => {
        try {
          return await manager.orgRollup(params.provider, params.org);
        } catch (e) {
          return err(set, e);
        }
      })

      // ── webhooks ──────────────────────────────────────────────────
      .get("/:provider/repos/:fqn/webhooks", async ({ params, set }) => {
        try {
          return await manager.listWebhooks(
            params.provider,
            decodeFqn(params.fqn),
          );
        } catch (e) {
          return err(set, e);
        }
      })
  );
}
