import { invoke } from "@tauri-apps/api/core";

export interface BackendPatchProposal {
  proposalId: string;
  workspaceId: string;
  relativePath: string;
  expectedRevision: string;
  original: string;
  proposed: string;
  contentDigest: string;
  source?: string;
  state: "pending" | "applying" | "applied" | "rejected" | "stale" | "failed" | "expired";
  createdAt: number;
  expiresAt: number;
}

export interface PatchApplyResult {
  proposalId: string;
  state: "applied";
  writeResult?: {
    workspaceId: string;
    fileId: string;
    relativePath: string;
    revision: string;
    byteLength: number;
  };
}

export function proposePatch(
  workspaceId: string,
  relativePath: string,
  expectedRevision: string,
  original: string,
  proposed: string,
  source = "editor-draft",
): Promise<BackendPatchProposal> {
  return invoke<BackendPatchProposal>("patch_propose", {
    request: { workspaceId, relativePath, expectedRevision, original, proposed, source },
  });
}

export function applyPatch(workspaceId: string, proposalId: string): Promise<PatchApplyResult> {
  return invoke<PatchApplyResult>("patch_apply", {
    request: { workspaceId, proposalId },
  });
}

export function rejectPatch(workspaceId: string, proposalId: string): Promise<void> {
  return invoke("patch_reject", {
    request: { workspaceId, proposalId },
  });
}
