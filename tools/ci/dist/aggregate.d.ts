export type WorkflowActionKind = "real" | "placeholder";
export type WorkflowActionStatus = "success" | "failure" | "not-run";
export type WorkflowActionResult = {
    action: string;
    kind: WorkflowActionKind;
    status: WorkflowActionStatus;
    steps?: unknown[];
};
export type WorkflowResult = {
    actions: WorkflowActionResult[];
    eventName: string;
    headSha: string;
    mode: string;
    provider: string;
    runAttempt: string;
    runId: string;
    schemaVersion: 1;
};
export type AggregatedActionResult = {
    action: string;
    passed: boolean;
    reason: string;
};
export type AggregateResult = {
    actions: AggregatedActionResult[];
    passed: boolean;
    owned: {
        provider: string;
        runId: string;
    };
    github: {
        provider: string;
        runId: string;
    };
    schemaVersion: 1;
};
export declare function parseWorkflowResult(value: unknown): WorkflowResult;
export declare function aggregateWorkflowResults(owned: WorkflowResult, github: WorkflowResult): AggregateResult;
export declare function aggregateWorkflowResultFiles(options: {
    githubResultsPath: string;
    outPath?: string;
    ownedResultsPath: string;
}): Promise<AggregateResult>;
//# sourceMappingURL=aggregate.d.ts.map