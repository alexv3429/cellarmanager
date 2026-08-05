import { powerSyncDatabase } from "./database"
import { PowerSyncConnector } from "./PowerSyncConnector"

const connector = new PowerSyncConnector()

let activeUserId: string | null = null
let pendingOperation: Promise<void> = Promise.resolve()

export function setPowerSyncUser(
  userId: string | null,
): Promise<void> {
  pendingOperation = pendingOperation
    .catch(() => undefined)
    .then(async () => {
      if (activeUserId === userId) {
        return
      }

      if (activeUserId !== null) {
        await powerSyncDatabase.disconnect()
        activeUserId = null
      }

      if (userId !== null) {
        await powerSyncDatabase.connect(connector)
        activeUserId = userId
      }
    })

  return pendingOperation
}
