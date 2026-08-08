import { requireSetupLabel } from "./cellarSetupLabels"
import { supabase } from "./supabase"

export async function createFirstHousehold(
  householdName: string,
  cellarName: string,
  locationCode: string,
): Promise<string> {
  const { data, error } = await supabase.rpc(
    "create_first_household",
    {
      p_household_name: requireSetupLabel(
        householdName,
        "Household name",
      ),
      p_cellar_name: requireSetupLabel(
        cellarName,
        "Cellar name",
      ),
      p_location_code: requireSetupLabel(
        locationCode,
        "Location code",
      ),
    },
  )

  if (error) {
    throw new Error(error.message)
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error(
      "Household creation returned an invalid identifier",
    )
  }

  return data
}
