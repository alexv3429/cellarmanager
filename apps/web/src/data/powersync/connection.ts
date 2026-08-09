import {
  clearDatabaseOwner,
  readDatabaseOwner,
  setDatabaseOwner,
} from "../../auth/localAccess"
import {
  clearDeviceIdentities,
} from "../../devices/deviceIdentity"
import { powerSyncDatabase } from "./database"
import { PowerSyncConnector } from "./PowerSyncConnector"

const connector = new PowerSyncConnector()

let activeUserId: string | null = null
let connectionRequested = false
let pendingOperation: Promise<void> = Promise.resolve()

interface PowerSyncAccess {
  userId: string | null
  connectToBackend: boolean
}

function serialize(
  operation: () => Promise<void>,
): Promise<void> {
  pendingOperation = pendingOperation
    .catch(() => undefined)
    .then(operation)

  return pendingOperation
}

async function clearForUserChange(): Promise<void> {
  await powerSyncDatabase.disconnectAndClear()

  clearDatabaseOwner(window.localStorage)
  clearDeviceIdentities(window.localStorage)

  activeUserId = null
  connectionRequested = false
}

export function setPowerSyncAccess({
  userId,
  connectToBackend,
}: PowerSyncAccess): Promise<void> {
  return serialize(async () => {
    if (userId === null) {
      if (connectionRequested) {
        await powerSyncDatabase.disconnect()
      }

      activeUserId = null
      connectionRequested = false
      return
    }

    const databaseOwner = readDatabaseOwner(
      window.localStorage,
    )

    const userChanged =
      (databaseOwner !== null &&
        databaseOwner !== userId) ||
      (activeUserId !== null &&
        activeUserId !== userId)

    if (userChanged) {
      await clearForUserChange()
    }

    setDatabaseOwner(window.localStorage, userId)
    activeUserId = userId

    if (!connectToBackend) {
      if (connectionRequested) {
        await powerSyncDatabase.disconnect()
      }

      connectionRequested = false
      return
    }

    if (!connectionRequested) {
      await powerSyncDatabase.connect(connector)
      connectionRequested = true
    }
  })
}

export function clearPowerSyncForSignOut(): Promise<void> {
  return serialize(async () => {
    // Keep ownership markers intact if clearing fails. A later
    // sign-in by another user will then detect the old owner and
    // retry disconnectAndClear before exposing local data.
    await powerSyncDatabase.disconnectAndClear()

    clearDatabaseOwner(window.localStorage)
    clearDeviceIdentities(window.localStorage)

    activeUserId = null
    connectionRequested = false
  })
}
