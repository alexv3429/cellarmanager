import { supabase } from "./supabase"

function cleanSetupLabel(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

function requireSetupLabel(
  value: string,
  fieldName: string,
): string {
  const cleaned = cleanSetupLabel(value)

  if (cleaned.length === 0) {
    throw new Error(`${fieldName} is required`)
  }

  return cleaned
}

async function requireRpcSuccess(
  promise: PromiseLike<{
    data: unknown
    error: { message: string } | null
  }>,
): Promise<void> {
  const { error } = await promise

  if (error) {
    throw new Error(error.message)
  }
}

export async function createCellar(
  householdId: string,
  name: string,
): Promise<void> {
  await requireRpcSuccess(
    supabase.rpc("create_cellar", {
      p_household_id: householdId,
      p_name: requireSetupLabel(name, "Cellar name"),
    }),
  )
}

export async function renameCellar(
  cellarId: string,
  name: string,
): Promise<void> {
  await requireRpcSuccess(
    supabase.rpc("rename_cellar", {
      p_cellar_id: cellarId,
      p_name: requireSetupLabel(name, "Cellar name"),
    }),
  )
}

export async function createLocation(
  householdId: string,
  cellarId: string,
  code: string,
): Promise<void> {
  await requireRpcSuccess(
    supabase.rpc("create_location", {
      p_household_id: householdId,
      p_cellar_id: cellarId,
      p_code: requireSetupLabel(code, "Location code"),
    }),
  )
}

export async function renameLocation(
  locationId: string,
  code: string,
): Promise<void> {
  await requireRpcSuccess(
    supabase.rpc("rename_location", {
      p_location_id: locationId,
      p_code: requireSetupLabel(code, "Location code"),
    }),
  )
}

export { cleanSetupLabel }
