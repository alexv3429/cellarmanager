import { describe, expect, it } from "vitest"

import {
  getSyncStatusPresentation,
  type SyncStatusInput,
} from "./syncStatusView"

const ready: SyncStatusInput = {
  connected: true,
  connecting: false,
  downloading: false,
  error: null,
  hasSynced: true,
  isOnline: true,
  pendingOperationCount: 0,
  uploading: false,
}

describe("synchronization status presentation", () => {
  it("reports the settled state", () => {
    expect(getSyncStatusPresentation(ready)).toEqual({
      detail: "Local data is ready and no changes are queued",
      label: "Up to date",
      state: "up-to-date",
      tone: "success",
    })
  })

  it("distinguishes upload, download, and initial synchronization", () => {
    expect(
      getSyncStatusPresentation({
        ...ready,
        pendingOperationCount: 2,
        uploading: true,
      }),
    ).toMatchObject({
      detail: "2 changes waiting for server confirmation",
      state: "uploading",
    })

    expect(
      getSyncStatusPresentation({ ...ready, downloading: true }),
    ).toMatchObject({ state: "refreshing" })

    expect(
      getSyncStatusPresentation({ ...ready, uploading: true }),
    ).toMatchObject({
      detail: "Sending local changes to the server",
      state: "uploading",
    })

    expect(
      getSyncStatusPresentation({ ...ready, hasSynced: false }),
    ).toMatchObject({ state: "initial" })
  })

  it("explains safely queued offline changes", () => {
    expect(
      getSyncStatusPresentation({
        ...ready,
        connected: false,
        isOnline: false,
        pendingOperationCount: 1,
      }),
    ).toEqual({
      detail:
        "1 change stored locally; synchronization resumes after reconnection",
      label: "Changes queued offline",
      state: "queued-offline",
      tone: "warning",
    })
  })

  it("distinguishes offline local access from an incomplete first sync", () => {
    expect(
      getSyncStatusPresentation({
        ...ready,
        connected: false,
        isOnline: false,
      }),
    ).toMatchObject({
      detail: "Local cellar data is available on this device",
      state: "offline",
    })

    expect(
      getSyncStatusPresentation({
        ...ready,
        connected: false,
        hasSynced: false,
        isOnline: false,
      }),
    ).toMatchObject({
      detail: "Reconnect to finish the initial synchronization",
      state: "offline",
    })
  })

  it("reports connection waits and pending work", () => {
    expect(
      getSyncStatusPresentation({
        ...ready,
        connected: false,
        connecting: true,
        pendingOperationCount: 3,
      }),
    ).toEqual({
      detail: "3 changes waiting for the connection",
      label: "Connecting…",
      state: "connecting",
      tone: "info",
    })
  })

  it("gives synchronization errors precedence", () => {
    expect(
      getSyncStatusPresentation({
        ...ready,
        error: "Upload failed",
        pendingOperationCount: 2,
        uploading: true,
      }),
    ).toEqual({
      detail: "Upload failed",
      label: "Synchronization needs attention",
      state: "error",
      tone: "error",
    })
  })
})
