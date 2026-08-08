import { useQuery } from "@powersync/react"
import {
  type FormEvent,
  useState,
} from "react"

import {
  createCellar,
  createLocation,
  renameCellar,
  renameLocation,
} from "../data/cellarSetup"

interface CellarSetupViewProps {
  householdId: string
  isOnline: boolean
}

interface CellarRow {
  id: string
  household_id: string
  name: string
}

interface LocationRow {
  id: string
  household_id: string
  cellar_id: string
  code: string
}

const CELLARS_QUERY = `
  select id, household_id, name
  from cellars
  where household_id = ?
  order by name
`

const LOCATIONS_QUERY = `
  select id, household_id, cellar_id, code
  from locations
  where household_id = ?
  order by code
`

function formValue(
  form: HTMLFormElement,
  name: string,
): string {
  return String(new FormData(form).get(name) ?? "")
}

export function CellarSetupView({
  householdId,
  isOnline,
}: CellarSetupViewProps) {
  const { data: cellars, error: cellarsError } =
    useQuery<CellarRow>(
      CELLARS_QUERY,
      [householdId],
    )

  const { data: locations, error: locationsError } =
    useQuery<LocationRow>(
      LOCATIONS_QUERY,
      [householdId],
    )

  const [busyAction, setBusyAction] =
    useState<string | null>(null)

  const [message, setMessage] =
    useState<string | null>(null)

  const [mutationError, setMutationError] =
    useState<string | null>(null)

  const error =
    cellarsError ?? locationsError

  async function runMutation(
    action: string,
    successMessage: string,
    mutation: () => Promise<void>,
  ): Promise<boolean> {
    setMessage(null)
    setMutationError(null)

    if (!isOnline) {
      setMutationError(
        "Reconnect before changing cellar setup.",
      )
      return false
    }

    setBusyAction(action)

    try {
      await mutation()
      setMessage(successMessage)
      return true
    } catch (caughtError: unknown) {
      setMutationError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save cellar setup",
      )
      return false
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCreateCellar(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    const form = event.currentTarget

    const name = formValue(form, "name")

    const saved = await runMutation(
      "create-cellar",
      "Cellar saved. Waiting for synchronization.",
      () => createCellar(householdId, name),
    )

    if (saved) {
      form.reset()
    }
  }

  async function handleCreateLocation(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    const form = event.currentTarget

    const cellarId = formValue(form, "cellarId")
    const cellar = cellars.find(
      (candidate) => candidate.id === cellarId,
    )

    if (!cellar) {
      setMutationError("Select a cellar first.")
      return
    }

    const code = formValue(form, "code")

    const saved = await runMutation(
      "create-location",
      "Location saved. Waiting for synchronization.",
      () =>
        createLocation(
          cellar.household_id,
          cellar.id,
          code,
        ),
    )

    if (saved) {
      form.reset()
    }
  }

  return (
    <main>
      <h1>Cellar setup</h1>
      <p>
        Cellars and named locations synchronize to every device.
        Setup changes currently require a connection; inventory
        ADD, MOVE, and REMOVE remain local-first.
      </p>

      {!isOnline ? (
        <p>Offline · setup changes are disabled.</p>
      ) : null}

      {error ? <p role="alert">{String(error)}</p> : null}
      {message ? <p>{message}</p> : null}
      {mutationError ? (
        <p role="alert">{mutationError}</p>
      ) : null}

      <h2>Create cellar</h2>

      <form onSubmit={(event) => void handleCreateCellar(event)}>
        <label>
          Cellar name
          <input name="name" required />
        </label>

        <button
          disabled={
            !isOnline ||
            busyAction !== null
          }
          type="submit"
        >
          {busyAction === "create-cellar"
            ? "Saving…"
            : "Create cellar"}
        </button>
      </form>

      <h2>Create location</h2>

      <form onSubmit={(event) => void handleCreateLocation(event)}>
        <label>
          Cellar
          <select
            defaultValue={cellars[0]?.id ?? ""}
            name="cellarId"
            required
          >
            {cellars.map((cellar) => (
              <option key={cellar.id} value={cellar.id}>
                {cellar.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Location code
          <input name="code" required />
        </label>

        <button
          disabled={
            !isOnline ||
            cellars.length === 0 ||
            busyAction !== null
          }
          type="submit"
        >
          {busyAction === "create-location"
            ? "Saving…"
            : "Create location"}
        </button>
      </form>

      <h2>Existing cellars and locations</h2>

      {cellars.length === 0 ? (
        <p>No synchronized cellars found.</p>
      ) : null}

      {cellars.map((cellar) => {
        const cellarLocations = locations.filter(
          (location) => location.cellar_id === cellar.id,
        )

        return (
          <section key={cellar.id}>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const form = event.currentTarget
                void runMutation(
                  `rename-cellar:${cellar.id}`,
                  "Cellar renamed. Waiting for synchronization.",
                  () =>
                    renameCellar(
                      cellar.id,
                      formValue(form, "name"),
                    ),
                )
              }}
            >
              <label>
                Cellar
                <input
                  defaultValue={cellar.name}
                  name="name"
                  required
                />
              </label>

              <button
                disabled={!isOnline || busyAction !== null}
                type="submit"
              >
                {busyAction === `rename-cellar:${cellar.id}`
                  ? "Saving…"
                  : "Rename cellar"}
              </button>
            </form>

            {cellarLocations.length === 0 ? (
              <p>No locations in this cellar.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Rename</th>
                  </tr>
                </thead>

                <tbody>
                  {cellarLocations.map((location) => (
                    <tr key={location.id}>
                      <td>{location.code}</td>
                      <td>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault()
                            const form = event.currentTarget
                            void runMutation(
                              `rename-location:${location.id}`,
                              "Location renamed. Waiting for synchronization.",
                              () =>
                                renameLocation(
                                  location.id,
                                  formValue(form, "code"),
                                ),
                            )
                          }}
                        >
                          <input
                            aria-label={`Rename ${location.code}`}
                            defaultValue={location.code}
                            name="code"
                            required
                          />

                          <button
                            disabled={
                              !isOnline || busyAction !== null
                            }
                            type="submit"
                          >
                            {busyAction ===
                            `rename-location:${location.id}`
                              ? "Saving…"
                              : "Rename"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
    </main>
  )
}
