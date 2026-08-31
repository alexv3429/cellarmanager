export type GovernedProfileType =
  | "place"
  | "place-adjustment"
  | "vintage"
  | "producer-era"
  | "producer-vintage-interaction"
  | "cuvee"
  | "release"

export type ProfileRevisionStatus =
  | "proposed"
  | "approved"
  | "disputed"
  | "superseded"
  | "published"

export type ProfileGovernanceCaseStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "dismissed"

export interface ProfileGovernanceEvidence {
  claimType: string
  reviewedAt: string
  role: string
  url: string
}

export interface ProfileKnowledgeVersion {
  contentSha256: string | null
  id: string
  label: string
  number: number
  publishedAt: string | null
  status: string
}

export interface GovernedProfileSnapshot {
  confidence: number
  createdAt: string
  evidence: ProfileGovernanceEvidence[]
  knowledgeVersion: ProfileKnowledgeVersion
  profileId: string
  profileType: GovernedProfileType
  rationale: string
  reviewedAt: string | null
  reviewedBy: string | null
  typed: Record<string, unknown>
}

export interface ProfileGovernanceReport {
  comment: string
  createdAt: string
  evidenceUrl: string | null
  kind: string
}

export interface ProfileRevisionDecision {
  curator: string
  decidedAt: string
  evidenceUrls: string[]
  id: string
  rationale: string
  verdict: "approve" | "disagree"
}

export interface ProfileRevisionProposal {
  confidence: number
  profileType: GovernedProfileType
  rationale: string
  typed: Record<string, unknown>
}

export interface ProfileRevision {
  decisions: ProfileRevisionDecision[]
  evidenceUrls: string[]
  id: string
  predecessorProfile: GovernedProfileSnapshot
  proposal: ProfileRevisionProposal
  proposalSha256: string
  proposedAt: string
  proposedBy: string
  publishedAt: string | null
  publishedProfile: GovernedProfileSnapshot | null
  status: ProfileRevisionStatus
  supersededAt: string | null
}

export interface ProfileGovernanceEvent {
  actor: string | null
  detail: Record<string, unknown>
  occurredAt: string
  type: string
}

export interface ProfileGovernanceItem {
  caseId: string
  currentProfile: GovernedProfileSnapshot
  events: ProfileGovernanceEvent[]
  openedAt: string
  profileType: GovernedProfileType
  reporterCount: number
  reports: ProfileGovernanceReport[]
  resolutionSummary: string | null
  resolvedAt: string | null
  revisions: ProfileRevision[]
  status: ProfileGovernanceCaseStatus
  subject: Record<string, unknown>
  subjectKey: string
  subjectTitle: string
  updatedAt: string
}

export interface ProfileCuratorEligibility {
  displayName: string | null
  eligible: boolean
  grantedAt: string | null
  grantedBy: string | null
  profileScopes: GovernedProfileType[]
  rationale: string | null
  status: string
}

export interface ProfileGovernanceInbox {
  curator: ProfileCuratorEligibility
  items: ProfileGovernanceItem[]
  status: "available"
}

interface RpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{
    data?: unknown
    error: { message: string } | null
  }>
}

async function defaultClient(): Promise<RpcClient> {
  const { supabase } = await import("./supabase")
  return supabase
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be non-empty text`)
  }
  return value.trim()
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null
  return text(value, field)
}

function dateText(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`${field} is invalid`)
  return parsed
}

function optionalDateText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null
  return dateText(value, field)
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`)
  }
  return value
}

function integer(value: unknown, field: string): number {
  const parsed = number(value, field)
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`)
  return parsed
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`)
  return value
}

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((entry, index) =>
    text(entry, `${field} item ${index + 1}`),
  )
}

function profileType(value: unknown, field: string): GovernedProfileType {
  if (
    value !== "place" &&
    value !== "place-adjustment" &&
    value !== "vintage" &&
    value !== "producer-era" &&
    value !== "producer-vintage-interaction" &&
    value !== "cuvee" &&
    value !== "release"
  ) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function revisionStatus(value: unknown, field: string): ProfileRevisionStatus {
  if (
    value !== "proposed" &&
    value !== "approved" &&
    value !== "disputed" &&
    value !== "superseded" &&
    value !== "published"
  ) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function caseStatus(value: unknown, field: string): ProfileGovernanceCaseStatus {
  if (
    value !== "open" &&
    value !== "reviewing" &&
    value !== "resolved" &&
    value !== "dismissed"
  ) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function parseProfileSnapshot(
  value: unknown,
  field: string,
): GovernedProfileSnapshot {
  const snapshot = record(value, field)
  const version = record(snapshot.knowledge_version, `${field} knowledge version`)
  const confidence = number(snapshot.confidence, `${field} confidence`)
  if (confidence < 0 || confidence > 1) {
    throw new Error(`${field} confidence must be between 0 and 1`)
  }

  return {
    confidence,
    createdAt: dateText(snapshot.created_at, `${field} creation time`),
    evidence: array(snapshot.evidence, `${field} evidence`).map((value, index) => {
      const evidence = record(value, `${field} evidence ${index + 1}`)
      return {
        claimType: text(evidence.claim_type, "Evidence claim type"),
        reviewedAt: dateText(evidence.reviewed_at, "Evidence review time"),
        role: text(evidence.role, "Evidence role"),
        url: text(evidence.url, "Evidence URL"),
      }
    }),
    knowledgeVersion: {
      contentSha256: optionalText(version.content_sha256, "Version content hash"),
      id: text(version.id, "Version ID"),
      label: text(version.label, "Version label"),
      number: integer(version.number, "Version number"),
      publishedAt: optionalDateText(version.published_at, "Version publication time"),
      status: text(version.status, "Version status"),
    },
    profileId: text(snapshot.profile_id, `${field} profile ID`),
    profileType: profileType(snapshot.profile_type, `${field} profile type`),
    rationale: text(snapshot.rationale, `${field} rationale`),
    reviewedAt: optionalDateText(snapshot.reviewed_at, `${field} review time`),
    reviewedBy: optionalText(snapshot.reviewed_by, `${field} reviewer`),
    typed: record(snapshot.typed, `${field} typed values`),
  }
}

function parseProposal(value: unknown, field: string): ProfileRevisionProposal {
  const proposal = record(value, field)
  return {
    confidence: number(proposal.confidence, `${field} confidence`),
    profileType: profileType(proposal.profile_type, `${field} profile type`),
    rationale: text(proposal.rationale, `${field} rationale`),
    typed: record(proposal.typed, `${field} typed values`),
  }
}

export function parseProfileGovernanceInbox(
  value: unknown,
): ProfileGovernanceInbox {
  const result = record(value, "Profile governance inbox")
  if (result.status !== "available") {
    throw new Error("Profile governance inbox status is invalid")
  }
  const curator = record(result.curator, "Profile curator")
  const eligible = boolean(curator.eligible, "Profile curator eligibility")

  return {
    curator: {
      displayName: optionalText(curator.display_name, "Curator display name"),
      eligible,
      grantedAt: optionalDateText(curator.granted_at, "Curator grant time"),
      grantedBy: optionalText(curator.granted_by, "Curator grant origin"),
      profileScopes: curator.profile_scopes === undefined
        ? []
        : array(curator.profile_scopes, "Curator profile scopes").map((value) =>
            profileType(value, "Curator profile scope"),
          ),
      rationale: optionalText(curator.rationale, "Curator rationale"),
      status: text(curator.status, "Curator status"),
    },
    items: array(result.items, "Profile governance items").map((value, index) => {
      const item = record(value, `Profile governance item ${index + 1}`)
      const currentProfile = parseProfileSnapshot(
        item.current_profile,
        `Profile governance item ${index + 1} current profile`,
      )
      const reporterCount = integer(item.reporter_count, "Reporter count")
      if (reporterCount < 1) throw new Error("Reporter count must be positive")

      return {
        caseId: text(item.case_id, "Profile governance case ID"),
        currentProfile,
        events: array(item.events, "Profile governance events").map(
          (value, eventIndex) => {
            const event = record(value, `Governance event ${eventIndex + 1}`)
            return {
              actor: optionalText(event.actor, "Governance event actor"),
              detail: record(event.detail, "Governance event detail"),
              occurredAt: dateText(event.occurred_at, "Governance event time"),
              type: text(event.type, "Governance event type"),
            }
          },
        ),
        openedAt: dateText(item.opened_at, "Profile governance opened time"),
        profileType: profileType(item.profile_type, "Governance profile type"),
        reporterCount,
        reports: array(item.reports, "Profile governance reports").map(
          (value, reportIndex) => {
            const report = record(value, `Governance report ${reportIndex + 1}`)
            return {
              comment: text(report.comment, "Governance report comment"),
              createdAt: dateText(report.created_at, "Governance report time"),
              evidenceUrl: optionalText(
                report.evidence_url,
                "Governance report evidence URL",
              ),
              kind: text(report.kind, "Governance report kind"),
            }
          },
        ),
        resolutionSummary: optionalText(
          item.resolution_summary,
          "Governance resolution summary",
        ),
        resolvedAt: optionalDateText(item.resolved_at, "Governance resolution time"),
        revisions: array(item.revisions, "Profile revisions").map(
          (value, revisionIndex) => {
            const revision = record(value, `Profile revision ${revisionIndex + 1}`)
            return {
              decisions: array(revision.decisions, "Profile revision decisions").map(
                (value, decisionIndex) => {
                  const decision = record(value, `Revision decision ${decisionIndex + 1}`)
                  if (decision.verdict !== "approve" && decision.verdict !== "disagree") {
                    throw new Error("Revision decision verdict is invalid")
                  }
                  return {
                    curator: text(decision.curator, "Revision decision curator"),
                    decidedAt: dateText(decision.decided_at, "Revision decision time"),
                    evidenceUrls: stringArray(
                      decision.evidence_urls,
                      "Revision decision evidence URLs",
                    ),
                    id: text(decision.id, "Revision decision ID"),
                    rationale: text(decision.rationale, "Revision decision rationale"),
                    verdict: decision.verdict,
                  }
                },
              ),
              evidenceUrls: stringArray(
                revision.evidence_urls,
                "Profile revision evidence URLs",
              ),
              id: text(revision.id, "Profile revision ID"),
              predecessorProfile: parseProfileSnapshot(
                revision.predecessor_profile,
                "Revision predecessor profile",
              ),
              proposal: parseProposal(revision.proposal, "Profile revision proposal"),
              proposalSha256: text(revision.proposal_sha256, "Proposal hash"),
              proposedAt: dateText(revision.proposed_at, "Profile revision proposal time"),
              proposedBy: text(revision.proposed_by, "Profile revision proposer"),
              publishedAt: optionalDateText(
                revision.published_at,
                "Profile revision publication time",
              ),
              publishedProfile: revision.published_profile === null
                ? null
                : parseProfileSnapshot(
                    revision.published_profile,
                    "Published profile revision",
                  ),
              status: revisionStatus(revision.status, "Profile revision status"),
              supersededAt: optionalDateText(
                revision.superseded_at,
                "Profile revision supersession time",
              ),
            }
          },
        ),
        status: caseStatus(item.status, "Profile governance case status"),
        subject: record(item.subject, "Profile governance subject"),
        subjectKey: text(item.subject_key, "Profile governance subject key"),
        subjectTitle: text(item.subject_title, "Profile governance subject title"),
        updatedAt: dateText(item.updated_at, "Profile governance update time"),
      }
    }),
    status: "available",
  }
}

async function callGovernanceRpc(
  functionName: string,
  parameters: Record<string, unknown>,
  rpcClient?: RpcClient,
): Promise<void> {
  const client = rpcClient ?? (await defaultClient())
  const { error } = await client.rpc(functionName, parameters)
  if (error) throw new Error(error.message)
}

export async function getProfileGovernanceInbox(
  rpcClient?: RpcClient,
): Promise<ProfileGovernanceInbox> {
  const client = rpcClient ?? (await defaultClient())
  const { data, error } = await client.rpc(
    "get_enrichment_profile_governance_inbox",
    {},
  )
  if (error) throw new Error(error.message)
  return parseProfileGovernanceInbox(data)
}

export function proposeProfileRevision(
  caseId: string,
  proposal: ProfileRevisionProposal,
  evidenceUrls: string[],
  rpcClient?: RpcClient,
): Promise<void> {
  return callGovernanceRpc(
    "propose_enrichment_profile_revision",
    {
      p_case_id: caseId,
      p_evidence_urls: evidenceUrls,
      p_proposal: {
        confidence: proposal.confidence,
        profile_type: proposal.profileType,
        rationale: proposal.rationale,
        typed: proposal.typed,
      },
    },
    rpcClient,
  )
}

export function reviewProfileRevision(
  revisionId: string,
  verdict: "approve" | "disagree",
  rationale: string,
  evidenceUrls: string[],
  rpcClient?: RpcClient,
): Promise<void> {
  return callGovernanceRpc(
    "review_enrichment_profile_revision",
    {
      p_evidence_urls: evidenceUrls,
      p_rationale: rationale,
      p_revision_id: revisionId,
      p_verdict: verdict,
    },
    rpcClient,
  )
}

export function dismissProfileReviewCase(
  caseId: string,
  rationale: string,
  evidenceUrls: string[],
  rpcClient?: RpcClient,
): Promise<void> {
  return callGovernanceRpc(
    "dismiss_enrichment_profile_review_case",
    {
      p_case_id: caseId,
      p_evidence_urls: evidenceUrls,
      p_rationale: rationale,
    },
    rpcClient,
  )
}
