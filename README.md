# @vibecontrols/vibe-plugin-gitops

GitOps orchestrator (meta plugin) for VibeControls. Owns `/api/gitops/*` on the agent and dispatches to registered provider plugins.

## Architecture

```
@vibecontrols/vibe-plugin-gitops              (meta — this package)
├── @vibecontrols/vibe-plugin-gitops-github
├── @vibecontrols/vibe-plugin-gitops-gitlab
├── @vibecontrols/vibe-plugin-gitops-bitbucket
└── @vibecontrols/vibe-plugin-gitops-azdevops
```

The meta plugin does NOT implement a provider itself. It defines the `GitOpsProvider` contract and dispatches every operation (`listRepos`, `listPullRequests`, `pipelineAnalytics`, etc.) to the named provider registered in the agent's service registry under type `"gitops"`.

## Install

```bash
vibe plugin install @vibecontrols/vibe-plugin-gitops
vibe plugin install @vibecontrols/vibe-plugin-gitops-github   # at least one provider
```

## REST surface

All routes mounted at `/api/gitops/*` on the agent. Auth: `x-agent-api-key` header.

| Method     | Path                                                                             | Purpose                                |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| GET        | `/api/gitops/providers`                                                          | List registered providers + auth state |
| GET / POST | `/api/gitops/providers/active`                                                   | Get / set active provider              |
| POST       | `/api/gitops/:provider/auth`                                                     | Save credentials (PAT)                 |
| GET        | `/api/gitops/:provider/auth/validate`                                            | Validate stored credentials            |
| DELETE     | `/api/gitops/:provider/auth`                                                     | Revoke credentials                     |
| GET        | `/api/gitops/:provider/health`                                                   | Provider + rate-limit status           |
| GET        | `/api/gitops/:provider/repos`                                                    | List repos (`?org&limit&cursor`)       |
| GET        | `/api/gitops/:provider/repos/:fqn`                                               | Repo metadata (fqn base64url)          |
| GET        | `/api/gitops/:provider/repos/:fqn/{branches,languages,contributors}`             | Repo sub-resources                     |
| GET        | `/api/gitops/:provider/repos/:fqn/pulls{,/:n,/analytics}`                        | PR data                                |
| GET        | `/api/gitops/:provider/repos/:fqn/{issues,labels}`                               | Issue data                             |
| GET        | `/api/gitops/:provider/repos/:fqn/{pipelines,runs,runs/:id,pipelines/analytics}` | CI data                                |
| GET        | `/api/gitops/:provider/repos/:fqn/security/alerts`                               | Security alerts                        |
| GET        | `/api/gitops/:provider/orgs/:org/rollup`                                         | Org-wide stats                         |

## CLI

```bash
vibe gitops providers ls
vibe gitops auth set github <PAT>
vibe gitops repos ls github --org algoshred
vibe gitops analytics github algoshred/vibe-plugin-tunnel
```

## License

Proprietary — see LICENSE.
