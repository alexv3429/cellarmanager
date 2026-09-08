import { describe, expect, it, vi } from "vitest"

import {
  acceptHouseholdInvitation,
  createHouseholdInvitation,
  getHouseholdInvitations,
  getInvitationDeliveries,
  sendHouseholdInvitationEmail,
  parseAcceptedHouseholdInvitation,
  parseHouseholdInvitationPreview,
  parseHouseholdInvitations,
  previewHouseholdInvitation,
  reissueHouseholdInvitation,
  revokeHouseholdInvitation,
} from "./householdInvitations"

const TOKEN = "a".repeat(64)

function createdResponse() {
  return [
    {
      invitation_expires_at: "2026-09-08T10:00:00Z",
      invitation_id: "invitation-1",
      invitation_token: TOKEN,
      invitee_email: "member@example.test",
    },
  ]
}

describe("household invitation data boundary", () => {
  it("sends only the invitation credential, not editable email, content or redirect", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ message: "Invitation email sent." }))
    const message = await sendHouseholdInvitationEmail({ id: "invitation-1", token: TOKEN, email: "member@example.test", expiresAt: "2026-09-14T10:00:00Z" }, { accessToken: "session", fetch: fetcher })
    expect(message).toBe("Invitation email sent.")
    expect(fetcher).toHaveBeenCalledWith("/api/household-invitations/email", expect.objectContaining({
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer session" },
      body: JSON.stringify({ invitationId: "invitation-1", token: TOKEN }),
    }))
  })

  it("preserves explicit email errors and treats network failure as uncertain", async () => {
    const invitation = { id: "invitation-1", token: TOKEN, email: "member@example.test", expiresAt: "2026-09-14T10:00:00Z" }
    await expect(sendHouseholdInvitationEmail(invitation, { accessToken: "session", fetch: vi.fn().mockResolvedValue(Response.json({ message: "Please wait" }, { status: 429 })) })).rejects.toThrow("Please wait")
    await expect(sendHouseholdInvitationEmail(invitation, { accessToken: "session", fetch: vi.fn().mockRejectedValue(new Error("offline")) })).rejects.toThrow("could not be confirmed")
    await expect(sendHouseholdInvitationEmail(invitation, { accessToken: "session", fetch: vi.fn().mockResolvedValue(new Response("HTML")) })).rejects.toThrow("could not be confirmed")
  })

  it("loads owner-only delivery status separately from acceptance", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ invitation_id: "invitation-1", delivery_status: "sent", attempted_at: "2026-09-07T10:00:00Z" }], error: null })
    expect(await getInvitationDeliveries("household-1", { rpc })).toEqual([{ invitationId: "invitation-1", status: "sent", attemptedAt: "2026-09-07T10:00:00Z" }])
    expect(rpc).toHaveBeenCalledWith("get_household_invitation_deliveries", { p_household_id: "household-1" })
  })
  it("parses owner invitation lists and effective actions", () => {
    expect(
      parseHouseholdInvitations([
        {
          can_reissue: true,
          can_revoke: true,
          created_at: "2026-09-01T10:00:00Z",
          expires_at: "2026-09-08T10:00:00Z",
          invitation_id: "invitation-1",
          invitation_status: "pending",
          invitee_email: "member@example.test",
          requested_role: "member",
          resolved_at: null,
        },
      ]),
    ).toEqual([
      {
        canReissue: true,
        canRevoke: true,
        createdAt: "2026-09-01T10:00:00Z",
        email: "member@example.test",
        expiresAt: "2026-09-08T10:00:00Z",
        id: "invitation-1",
        requestedRole: "member",
        resolvedAt: null,
        status: "pending",
      },
    ])
  })

  it("parses anonymous and authenticated previews", () => {
    const response = [
      {
        account_exists: true,
        account_matches: null,
        expires_at: "2026-09-08T10:00:00Z",
        household_name: "Family cellar",
        invitation_status: "pending",
        invitee_email: "member@example.test",
        invitee_email_hint: "m***@example.test",
        requested_role: "member",
      },
    ]

    expect(
      parseHouseholdInvitationPreview(response),
    ).toMatchObject({
      accountExists: true,
      accountMatches: null,
      email: "member@example.test",
      householdName: "Family cellar",
      status: "pending",
    })
    expect(parseHouseholdInvitationPreview([])).toBeNull()
  })

  it("parses an accepted membership", () => {
    expect(
      parseAcceptedHouseholdInvitation([
        {
          accepted_at: "2026-09-01T10:05:00Z",
          household_id: "household-1",
          household_name: "Family cellar",
          membership_id: "membership-1",
          membership_role: "member",
        },
      ]),
    ).toEqual({
      acceptedAt: "2026-09-01T10:05:00Z",
      householdId: "household-1",
      householdName: "Family cellar",
      membershipId: "membership-1",
      membershipRole: "member",
    })
  })

  it("rejects malformed statuses, roles, and cardinality", () => {
    expect(() =>
      parseHouseholdInvitations([
        {
          can_reissue: true,
          can_revoke: true,
          created_at: "2026-09-01T10:00:00Z",
          expires_at: "2026-09-08T10:00:00Z",
          invitation_id: "invitation-1",
          invitation_status: "open",
          invitee_email: "member@example.test",
          requested_role: "owner",
          resolved_at: null,
        },
      ]),
    ).toThrow("Invitation role is invalid")
    expect(() =>
      parseAcceptedHouseholdInvitation([]),
    ).toThrow("must contain one result")
  })

  it("calls the create, list, preview, accept, reissue, and revoke RPCs", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: createdResponse(),
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            accepted_at: "2026-09-01T10:05:00Z",
            household_id: "household-1",
            household_name: "Family cellar",
            membership_id: "membership-1",
            membership_role: "member",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: createdResponse(),
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            invitation_id: "invitation-1",
            invitation_status: "revoked",
            revoked_at: "2026-09-01T10:06:00Z",
          },
        ],
        error: null,
      })

    const options = { rpc }
    await createHouseholdInvitation(
      "household-1",
      "member@example.test",
      options,
    )
    await getHouseholdInvitations(
      "household-1",
      options,
    )
    await previewHouseholdInvitation(TOKEN, options)
    await acceptHouseholdInvitation(TOKEN, options)
    await reissueHouseholdInvitation(
      "household-1",
      "invitation-1",
      options,
    )
    await revokeHouseholdInvitation(
      "household-1",
      "invitation-1",
      options,
    )

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "create_household_invitation",
      {
        p_household_id: "household-1",
        p_invitee_email: "member@example.test",
      },
    )
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "preview_household_invitation",
      { p_invitation_token: TOKEN },
    )
    expect(rpc).toHaveBeenNthCalledWith(
      6,
      "revoke_household_invitation",
      {
        p_household_id: "household-1",
        p_invitation_id: "invitation-1",
      },
    )
  })

  it("surfaces RPC failures without parsing partial data", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Household owner permission is required" },
    })

    await expect(
      getHouseholdInvitations("household-1", { rpc }),
    ).rejects.toThrow("Household owner permission is required")
  })
})
