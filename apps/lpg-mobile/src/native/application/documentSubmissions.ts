import {
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";

const READY_DOCUMENT_STATUSES = new Set([
  "uploaded",
  "submitted",
  "under_review",
  "approved",
]);

function submissionTimestamp(record: PlatformRecord): number {
  // A reviewer can update an older row after a newer file has been uploaded.
  // Order by the upload's creation time first, not its last review update.
  const values = [
    record.created_at,
    record.createdAt,
    record.submitted_at,
    record.submittedAt,
    record.updated_at,
    record.updatedAt,
  ];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  return 0;
}

/**
 * Resolve the newest saved submission for one configured requirement.
 * Re-uploads create new document_submissions rows, so relying on the first
 * matching row can let an older rejected upload hide a newer valid one.
 */
export function latestDocumentSubmissionForRequirement(
  submissions: readonly PlatformRecord[],
  requirementKey: string,
  requirement: PlatformRecord | null | undefined,
): PlatformRecord | null {
  const requirementId = requirement ? recordId(requirement) : null;

  return [...submissions]
    .filter((submission) => {
      const submissionKey = firstString(submission, [
        "requirement_key",
        "requirementKey",
      ]);
      const submissionRequirementId = firstString(submission, [
        "requirement_id",
        "requirementId",
      ]);

      return (
        (Boolean(requirementId) && submissionRequirementId === requirementId) ||
        submissionKey === requirementKey
      );
    })
    .sort((a, b) => submissionTimestamp(b) - submissionTimestamp(a))[0] ?? null;
}

/**
 * Match the document states accepted by the application submission gate.
 * A rejected, expired, quarantined, or replacement-requested file must not
 * satisfy a required document, even when an older upload exists.
 */
export function documentSubmissionIsReady(
  submission: PlatformRecord | null | undefined,
): boolean {
  if (!submission) return false;

  const replacementRequested =
    submission.replacement_requested === true ||
    submission.replacementRequested === true;

  if (replacementRequested) return false;

  const status = firstString(submission, ["status"])?.toLowerCase() ?? "";
  return READY_DOCUMENT_STATUSES.has(status);
}
