# @vibecontrols/vibe-plugin-gitops

<!-- VIBECONTROLS_OSS_HEADER_START -->

> **License**: MIT — see [LICENSE](./LICENSE).
> **Note**: This plugin is open source. The `@vibecontrols/agent` runtime that loads it is **not** open source — it is a proprietary product of Burdenoff Consultancy Services Pvt. Ltd. See [vibecontrols.com](https://vibecontrols.com) for the agent.

<!-- VIBECONTROLS_OSS_HEADER_END -->

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

<!-- VIBECONTROLS_OSS_FOOTER_START -->

---

## License

Released under the [MIT License](./LICENSE).

Copyright (c) 2026 Burdenoff Consultancy Services Private Limited, Algoshred Technologies Private Limited, and all its sister companies.

Maintainer: **Vignesh T.V** — <https://github.com/tvvignesh>

## About VibeControls

**VibeControls** is the agentic engineering mission control for AI-native teams. Vibe-plugins extend the VibeControls agent with new providers, tools, sessions, tunnels, storage backends, and security stages.

- Website: <https://vibecontrols.com>
- Documentation: <https://docs.vibecontrols.com>
- Plugin SDK: <https://github.com/algoshred/vibecontrols-plugin-sdk>
- All plugins: <https://github.com/algoshred?q=vibe-plugin-&type=all>

## Important: agent is not open source

The `@vibecontrols/agent` runtime that loads and orchestrates these plugins is **closed source** and proprietary to Burdenoff Consultancy Services Pvt. Ltd. Only the plugin contract and the plugins themselves are released under MIT. If you want a fully self-hostable agent, please open an issue or contact the maintainer.

<!-- VIBECONTROLS_OSS_FOOTER_END -->
