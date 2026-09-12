import { useQuery } from "@powersync/react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { supabase } from "../data/supabase"
import {
  getBrowserName,
  getOrCreateDeviceId,
} from "./deviceIdentity"

interface HouseholdMembershipRow {
  household_id: string
}

interface DeviceRow {
  id: string
  household_id: string
  user_id: string
  name: string
  revoked_at: string | null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to register this device"
}

export function useRegisteredDevices(
  userId: string,
  initialSyncComplete: boolean,
) {
  const {
    data: memberships,
    error: membershipsError,
    isLoading: membershipsLoading,
  } = useQuery<HouseholdMembershipRow>(
    `
      select household_id
      from household_members
      where user_id = ?
      order by household_id
    `,
    [userId],
  )

  const {
    data: devices,
    error: devicesError,
    isLoading: devicesLoading,
  } = useQuery<DeviceRow>(
    `
      select id, household_id, user_id, name, revoked_at
      from devices
      where user_id = ?
      order by created_at
    `,
    [userId],
  )

  const [expectedDeviceIds, setExpectedDeviceIds] =
    useState<Record<string, string>>({})

  const [registeringHouseholds, setRegisteringHouseholds] =
    useState<Set<string>>(() => new Set())

  const [registrationError, setRegistrationError] =
    useState<string | null>(null)

  const [retryToken, setRetryToken] = useState(0)
  const [knownRevokedIds, setKnownRevokedIds] = useState<Set<string>>(() => new Set())
  const markRevoked = useCallback((deviceId: string) => {
    setKnownRevokedIds((current) => current.has(deviceId) ? current : new Set([...current, deviceId]))
  }, [])

  const inFlightHouseholds = useRef(new Set<string>())
  const remotelyRegisteredHouseholds = useRef(new Set<string>())

  useEffect(() => {
    if (!initialSyncComplete) {
      return
    }

    try {
      const nextDeviceIds: Record<string, string> = {}

      for (const membership of memberships) {
        nextDeviceIds[membership.household_id] =
          getOrCreateDeviceId(
            window.localStorage,
            membership.household_id,
          )
      }

      setExpectedDeviceIds(nextDeviceIds)
    } catch (error: unknown) {
      setRegistrationError(getErrorMessage(error))
    }
  }, [initialSyncComplete, memberships])

  useEffect(() => {
    if (!initialSyncComplete) {
      return
    }

    for (const membership of memberships) {
      const householdId = membership.household_id
      const deviceId = expectedDeviceIds[householdId]

      if (!deviceId || knownRevokedIds.has(deviceId)) {
        continue
      }

      const alreadySynchronized = devices.some(
        (device) =>
          device.id === deviceId &&
          device.household_id === householdId &&
          device.user_id === userId,
      )

      if (
        alreadySynchronized ||
        inFlightHouseholds.current.has(householdId) ||
        remotelyRegisteredHouseholds.current.has(householdId)
      ) {
        continue
      }

      inFlightHouseholds.current.add(householdId)

      setRegisteringHouseholds((currentHouseholds) => {
        const nextHouseholds = new Set(currentHouseholds)
        nextHouseholds.add(householdId)
        return nextHouseholds
      })

      setRegistrationError(null)

      void (async () => {
        try {
          const { error } = await supabase.rpc(
            "register_device",
            {
              p_device_id: deviceId,
              p_household_id: householdId,
              p_name: getBrowserName(
                navigator.userAgent,
                navigator.platform,
              ),
            },
          )

          if (error) {
            if (error.code === "55000") { markRevoked(deviceId); return }
            throw new Error(
              `Device registration failed: ${error.message}`,
            )
          }

          remotelyRegisteredHouseholds.current.add(
            householdId,
          )
        } catch (error: unknown) {
          setRegistrationError(getErrorMessage(error))
        } finally {
          inFlightHouseholds.current.delete(householdId)

          setRegisteringHouseholds(
            (currentHouseholds) => {
              const nextHouseholds =
                new Set(currentHouseholds)

              nextHouseholds.delete(householdId)
              return nextHouseholds
            },
          )
        }
      })()
    }
  }, [
    devices,
    expectedDeviceIds,
    initialSyncComplete,
    memberships,
    retryToken,
    userId,
    knownRevokedIds,
    markRevoked,
  ])

  const deviceIdByHousehold = useMemo(() => {
    const synchronizedDeviceIds: Record<string, string> = {}

    for (const membership of memberships) {
      const householdId = membership.household_id
      const expectedDeviceId = expectedDeviceIds[householdId]

      if (!expectedDeviceId) {
        continue
      }

      const synchronizedDevice = devices.find(
        (device) =>
          device.id === expectedDeviceId &&
          device.household_id === householdId &&
          device.user_id === userId &&
          device.revoked_at === null &&
          !knownRevokedIds.has(device.id),
      )

      if (synchronizedDevice) {
        synchronizedDeviceIds[householdId] =
          synchronizedDevice.id
      }
    }

    return synchronizedDeviceIds
  }, [devices, expectedDeviceIds, memberships, userId, knownRevokedIds])

  const revokedHouseholdIds = memberships.filter((membership) => {
    const id = expectedDeviceIds[membership.household_id]
    return !!id && (knownRevokedIds.has(id) || devices.some((device) =>
      device.id === id && device.user_id === userId && device.household_id === membership.household_id && device.revoked_at !== null))
  }).map((membership) => membership.household_id)

  const retryRegistration = useCallback(() => {
    remotelyRegisteredHouseholds.current.clear()
    setRegistrationError(null)
    setRetryToken((currentToken) => currentToken + 1)
  }, [])

  useEffect(() => {
    window.addEventListener("online", retryRegistration)

    return () => {
      window.removeEventListener("online", retryRegistration)
    }
  }, [retryRegistration])

  const queryError =
    membershipsError !== null
      ? String(membershipsError)
      : devicesError !== null
        ? String(devicesError)
        : null

  const noHouseholdError =
    initialSyncComplete &&
    !membershipsLoading &&
    memberships.length === 0
      ? "No household membership is available for this user"
      : null

  const isLoading =
    membershipsLoading ||
    devicesLoading ||
    !initialSyncComplete

  const isRegistering = registeringHouseholds.size > 0

  const isReady =
    initialSyncComplete &&
    memberships.length > 0 &&
    memberships.every(
      (membership) =>
        deviceIdByHousehold[membership.household_id] !== undefined,
    )

  return {
    deviceIdByHousehold,
    expectedDeviceIds,
    revokedHouseholdIds,
    markRevoked,
    error:
      registrationError ??
      queryError ??
      noHouseholdError,
    isLoading,
    isReady,
    isRegistering,
    retryRegistration,
  }
}

export type RegisteredDevicesState = ReturnType<typeof useRegisteredDevices>
