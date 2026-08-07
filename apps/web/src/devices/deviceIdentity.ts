export const DEVICE_IDS_STORAGE_KEY =
  "cellarmanager.device_ids.v1"

export interface DeviceIdentityStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function clearDeviceIdentities(
  storage: DeviceIdentityStorage,
): void {
  storage.removeItem(DEVICE_IDS_STORAGE_KEY)
}

export function readStoredDeviceIds(
  storage: DeviceIdentityStorage,
): Record<string, string> {
  const rawValue = storage.getItem(
    DEVICE_IDS_STORAGE_KEY,
  )

  if (!rawValue) {
    return {}
  }

  const parsedValue: unknown = JSON.parse(rawValue)

  if (
    typeof parsedValue !== "object" ||
    parsedValue === null ||
    Array.isArray(parsedValue)
  ) {
    throw new Error("Stored device identity is invalid")
  }

  const deviceIds: Record<string, string> = {}

  for (const [householdId, deviceId] of Object.entries(
    parsedValue,
  )) {
    if (
      typeof householdId === "string" &&
      typeof deviceId === "string" &&
      deviceId.length > 0
    ) {
      deviceIds[householdId] = deviceId
    }
  }

  return deviceIds
}

export function getOrCreateDeviceId(
  storage: DeviceIdentityStorage,
  householdId: string,
  createUuid: () => string = () =>
    crypto.randomUUID(),
): string {
  const deviceIds = readStoredDeviceIds(storage)
  const existingDeviceId = deviceIds[householdId]

  if (existingDeviceId) {
    return existingDeviceId
  }

  const deviceId = createUuid()

  storage.setItem(
    DEVICE_IDS_STORAGE_KEY,
    JSON.stringify({
      ...deviceIds,
      [householdId]: deviceId,
    }),
  )

  return deviceId
}

export function getBrowserName(
  userAgent: string,
  platform: string,
): string {
  let browser = "Web browser"

  if (userAgent.includes("Edg/")) {
    browser = "Edge"
  } else if (
    userAgent.includes("Chrome/") ||
    userAgent.includes("CriOS/")
  ) {
    browser = "Chrome"
  } else if (
    userAgent.includes("Safari/") &&
    !userAgent.includes("Chrome/")
  ) {
    browser = "Safari"
  } else if (userAgent.includes("Firefox/")) {
    browser = "Firefox"
  }

  const normalizedPlatform = platform.trim()

  return normalizedPlatform
    ? `${browser} on ${normalizedPlatform}`.slice(0, 120)
    : browser
}
