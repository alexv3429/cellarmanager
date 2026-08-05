import {
  UpdateType,
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from "@powersync/web"

import { environment } from "../env"
import { supabase } from "../supabase"

function requireString(
  data: Record<string, unknown>,
  field: string,
): string {
  const value = data[field]

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid inventory operation field: ${field}`)
  }

  return value
}

function optionalString(
  data: Record<string, unknown>,
  field: string,
): string | null {
  const value = data[field]

  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid inventory operation field: ${field}`)
  }

  return value
}

function requirePositiveInteger(
  data: Record<string, unknown>,
  field: string,
): number {
  const value = data[field]

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`Invalid inventory operation field: ${field}`)
  }

  return value
}

export class PowerSyncConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession()

    if (error) {
      throw new Error(
        `Unable to retrieve Supabase session: ${error.message}`,
      )
    }

    if (!session) {
      return null
    }

    return {
      endpoint: environment.powerSyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    }
  }

  async uploadData(
    database: AbstractPowerSyncDatabase,
  ): Promise<void> {
    const transaction = await database.getNextCrudTransaction()

    if (!transaction) {
      return
    }

    for (const operation of transaction.crud) {
      if (
        operation.table !== "inventory_operations" ||
        operation.op !== UpdateType.PUT
      ) {
        throw new Error(
          `Unsupported local write: ${operation.op} ${operation.table}`,
        )
      }

      const data: Record<string, unknown> =
        operation.opData ?? {}

      const { error } = await supabase.rpc(
        "apply_inventory_operation",
        {
          p_operation_id: operation.id,
          p_household_id: requireString(
            data,
            "household_id",
          ),
          p_device_id: requireString(data, "device_id"),
          p_operation_type: requireString(
            data,
            "operation_type",
          ),
          p_wine_id: requireString(data, "wine_id"),
          p_source_location_id: requireString(
            data,
            "source_location_id",
          ),
          p_destination_location_id: optionalString(
            data,
            "destination_location_id",
          ),
          p_quantity: requirePositiveInteger(
            data,
            "quantity",
          ),
          p_created_at_client: requireString(
            data,
            "created_at_client",
          ),
        },
      )

      if (error) {
        throw new Error(
          `Inventory operation upload failed: ${error.message}`,
        )
      }
    }

    await transaction.complete()
  }
}
