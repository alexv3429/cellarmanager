export const LOCAL_ACCESS_STORAGE_KEY =
  "cellarmanager.local_access.v1"

export const DATABASE_OWNER_STORAGE_KEY =
  "cellarmanager.database_owner.v1"

export interface LocalAccessStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LocalAccessGrant {
  userId: string
  authenticatedAt: string
}

function requireNonEmptyString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `Stored local access field is invalid: ${field}`,
    )
  }

  return value
}

export function readLocalAccess(
  storage: LocalAccessStorage,
): LocalAccessGrant | null {
  const rawValue = storage.getItem(
    LOCAL_ACCESS_STORAGE_KEY,
  )

  if (!rawValue) {
    return null
  }

  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(rawValue)
  } catch {
    throw new Error("Stored local access grant is invalid")
  }

  if (
    typeof parsedValue !== "object" ||
    parsedValue === null ||
    Array.isArray(parsedValue)
  ) {
    throw new Error("Stored local access grant is invalid")
  }

  const record = parsedValue as Record<string, unknown>

  const userId = requireNonEmptyString(
    record.userId,
    "userId",
  )

  const authenticatedAt = requireNonEmptyString(
    record.authenticatedAt,
    "authenticatedAt",
  )

  if (Number.isNaN(Date.parse(authenticatedAt))) {
    throw new Error(
      "Stored local access field is invalid: authenticatedAt",
    )
  }

  return {
    userId,
    authenticatedAt,
  }
}

export function saveLocalAccess(
  storage: LocalAccessStorage,
  userId: string,
  authenticatedAt: Date = new Date(),
): LocalAccessGrant {
  const grant: LocalAccessGrant = {
    userId: requireNonEmptyString(userId, "userId"),
    authenticatedAt: authenticatedAt.toISOString(),
  }

  storage.setItem(
    LOCAL_ACCESS_STORAGE_KEY,
    JSON.stringify(grant),
  )

  return grant
}

export function clearLocalAccess(
  storage: LocalAccessStorage,
): void {
  storage.removeItem(LOCAL_ACCESS_STORAGE_KEY)
}

export function readDatabaseOwner(
  storage: LocalAccessStorage,
): string | null {
  const owner = storage.getItem(
    DATABASE_OWNER_STORAGE_KEY,
  )

  if (!owner) {
    return null
  }

  return requireNonEmptyString(owner, "databaseOwner")
}

export function setDatabaseOwner(
  storage: LocalAccessStorage,
  userId: string,
): void {
  storage.setItem(
    DATABASE_OWNER_STORAGE_KEY,
    requireNonEmptyString(userId, "databaseOwner"),
  )
}

export function clearDatabaseOwner(
  storage: LocalAccessStorage,
): void {
  storage.removeItem(DATABASE_OWNER_STORAGE_KEY)
}

export function resolveOfflineUserId(
  storage: LocalAccessStorage,
): string | null {
  const grant = readLocalAccess(storage)

  if (!grant) {
    return null
  }

  const databaseOwner = readDatabaseOwner(storage)

  if (databaseOwner !== grant.userId) {
    return null
  }

  return grant.userId
}
