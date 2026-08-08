import type {
  ExecutionProviderName,
  PolicyApprovedRecipe,
} from "@trialrun/domain";

import type { LiveBrowserEvidence } from "./live-browser";

export type ReviewSide = "base" | "head";

export interface SourceWorkspace {
  readonly sha: string;
  readonly directory: string;
}

export interface ProvisionInput {
  readonly reviewId: string;
  readonly ownershipTokenHash: string;
  readonly recipe: PolicyApprovedRecipe;
  readonly sourceWorkspaces: Readonly<Record<ReviewSide, SourceWorkspace>>;
  readonly secrets: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly onProjectCreated?: (providerProjectId: string) => Promise<void>;
}

export interface TeardownProof {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly providerProjectId: string;
  readonly deleted: boolean;
  readonly message: string;
}

export interface LiveReviewConnection {
  readonly mcpUrl: string;
  readonly bearerToken: string;
}

export interface ExecutionEnvironment {
  readonly provider: ExecutionProviderName;
  readonly providerProjectId: string;
  readonly baseUrl: string;
  readonly headUrl: string;
  readonly liveReview: LiveReviewConnection;
  readonly metadata?: Readonly<Record<string, string>>;
  readLiveEvidence(): Promise<LiveBrowserEvidence>;
  readLiveArtifact(artifactId: string): Promise<Uint8Array>;
  sealLiveReview(): Promise<LiveBrowserEvidence>;
  cancelLiveReview(): Promise<LiveBrowserEvidence>;
  readLogs(side: ReviewSide): Promise<string>;
  destroy(): Promise<TeardownProof>;
}

export interface ExecutionProvider {
  provision(input: ProvisionInput): Promise<ExecutionEnvironment>;
}
