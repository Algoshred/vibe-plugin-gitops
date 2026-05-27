/**
 * @vibecontrols/vibe-plugin-gitops
 *
 * GitOps orchestrator. Owns /api/gitops/* on the agent and dispatches to
 * concrete providers registered in the service registry under type
 * "gitops" (gitops-github, gitops-gitlab, gitops-bitbucket, gitops-azdevops).
 *
 * This plugin does NOT export providers.gitops — it is not itself a
 * provider. It delegates to whichever provider the caller chooses, or to
 * the default configured via `vibe gitops providers set-default`.
 */

import {
  createLifecycleHooks,
  TelemetryEmitter,
} from "@vibecontrols/plugin-sdk";
import type {
  HostServices,
  ProfileContext,
  VibePlugin,
  VibePluginFactory,
} from "@vibecontrols/plugin-sdk/contract";

import { registerGitopsCommands } from "./commands.js";
import { GitopsManager } from "./manager.js";
import { createGitopsManagerRoutes } from "./routes.js";

const PLUGIN_NAME = "gitops";
const PLUGIN_VERSION = "0.1.0";

export const createPlugin: VibePluginFactory = (
  _ctx: ProfileContext,
): VibePlugin => {
  const manager = new GitopsManager();
  const telemetry = new TelemetryEmitter(PLUGIN_NAME, PLUGIN_VERSION);

  const lifecycle = createLifecycleHooks({
    name: PLUGIN_NAME,
    telemetryEventName: "gitops.meta.ready",
    onInit: (hostServices: HostServices) => {
      manager.init(hostServices);
      telemetry.emit("gitops.manager.ready");
    },
  });

  return {
    capabilities: {
      storage: "rw",
      broadcast: true,
      audit: true,
      telemetry: true,
    },
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    description:
      "GitOps meta plugin — dispatches repo/PR/CI/security queries to registered providers (GitHub, GitLab, Bitbucket, Azure DevOps)",
    tags: ["backend", "cli", "integration"],
    cliCommand: "gitops",
    apiPrefix: "/api/gitops",

    createRoutes: () => createGitopsManagerRoutes(manager),

    onServerStart: lifecycle.onServerStart,
    onServerStop: lifecycle.onServerStop,

    onCliSetup: (program: unknown, hostServices: HostServices) => {
      registerGitopsCommands(
        program as Parameters<typeof registerGitopsCommands>[0],
        hostServices,
      );
    },
  };
};

export default createPlugin;
export { GitopsManager } from "./manager.js";
export { GitOpsError } from "./errors.js";
export type * from "./types.js";
