export declare const WORKSPACE_ROOT: string;
export type ToolCiProfile = "ci-base" | "ci-playwright" | "nix-capable" | "github" | "owned" | "local";
export type ToolCiSourceMode = "direct" | "copy";
export type ToolCiRoots = {
    artifactsRoot: string;
    cacheRoot: string;
    evidenceRoot: string;
    logsRoot: string;
    resultsRoot: string;
    runRoot: string;
    tmpRoot: string;
    toolCiRoot: string;
    workRoot: string;
};
export type ToolCiConfig = {
    capabilitiesPath: string;
    eventName: string;
    headSha: string;
    manifestPath: string;
    mode: string;
    profile: ToolCiProfile;
    providerId: string;
    roots: ToolCiRoots;
    runAttempt: string;
    runId: string;
    sourceMode: ToolCiSourceMode;
    workspaceRoot: string;
};
export type NormalizedEnvelope = {
    artifactsDir: string;
    cacheDir: string;
    capabilitiesPath: string;
    eventName: string;
    headSha: string;
    manifestPath: string;
    mode: string;
    providerId: string;
    repoDir: string;
    resultsDir: string;
    runAttempt: string;
    runId: string;
    tmpDir: string;
    workDir: string;
};
export type ToolCiConfigOptions = {
    capabilitiesPath?: string;
    eventName?: string;
    evidenceRoot?: string;
    headSha?: string;
    manifestPath?: string;
    mode?: string;
    profile?: ToolCiProfile;
    providerId?: string;
    runAttempt?: string;
    runId?: string;
    sourceMode?: ToolCiSourceMode;
    toolCiRoot?: string;
    workspaceRoot?: string;
};
export declare function resolveToolCiRoots(options: {
    evidenceRoot?: string;
    profile?: ToolCiProfile;
    runId: string;
    toolCiRoot?: string;
    workspaceRoot?: string;
}): ToolCiRoots;
export declare function resolveToolCiConfig(options?: ToolCiConfigOptions, env?: NodeJS.ProcessEnv): ToolCiConfig;
export declare function readNormalizedEnvelope(env?: NodeJS.ProcessEnv): NormalizedEnvelope;
//# sourceMappingURL=envelope.d.ts.map