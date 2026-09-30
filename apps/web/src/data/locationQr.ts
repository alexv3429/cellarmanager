const LOCATION_QR_PREFIX = "CMLOC1"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface LocationQrTarget {
  householdId: string
  locationId: string
}

/** A location label is an identifier, never an authorization credential. */
export function encodeLocationQr(target: LocationQrTarget): string {
  if (!UUID.test(target.householdId) || !UUID.test(target.locationId)) {
    throw new Error("Invalid location QR identifiers")
  }
  return `${LOCATION_QR_PREFIX}:${target.householdId.toLowerCase()}:${target.locationId.toLowerCase()}`
}

export function parseLocationQr(value: string): LocationQrTarget | null {
  const parts = value.trim().split(":")
  if (parts.length !== 3 || parts[0] !== LOCATION_QR_PREFIX) return null
  const [, householdId, locationId] = parts
  if (!householdId || !locationId || !UUID.test(householdId) || !UUID.test(locationId)) return null
  return { householdId: householdId.toLowerCase(), locationId: locationId.toLowerCase() }
}
