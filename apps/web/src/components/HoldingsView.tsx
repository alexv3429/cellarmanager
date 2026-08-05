import { useQuery, useStatus } from "@powersync/react"

import { supabase } from "../data/supabase"

interface HoldingRow {
  id: string
  producer: string
  cuvee: string
  vintage: number | null
  location_code: string
  quantity: number
  revision: number
}

const HOLDINGS_QUERY = `
  select
    h.id,
    w.producer,
    w.cuvee,
    w.vintage,
    l.code as location_code,
    h.quantity,
    h.revision
  from holdings h
  join wines w on w.id = h.wine_id
  join locations l on l.id = h.location_id
  order by
    w.producer,
    w.cuvee,
    w.vintage,
    l.code
`

export function HoldingsView() {
  const status = useStatus()

  const {
    data: holdings,
    error,
    isLoading,
    isFetching,
  } = useQuery<HoldingRow>(HOLDINGS_QUERY)

  async function signOut() {
    await supabase.auth.signOut({ scope: "local" })
  }

  return (
    <main>
      <header>
        <div>
          <h1>CellarManager</h1>
          <p>
            {status.connected ? "Connected" : "Offline"}
            {" · "}
            {status.hasSynced
              ? "Local data ready"
              : "Initial synchronization pending"}
            {isFetching ? " · Refreshing" : ""}
          </p>
        </div>

        <button onClick={() => void signOut()} type="button">
          Sign out
        </button>
      </header>

      <h2>Holdings</h2>

      {isLoading ? <p>Opening local database…</p> : null}
      {error ? <p role="alert">{String(error)}</p> : null}

      {!isLoading && holdings.length === 0 ? (
        <p>No synchronized holdings found.</p>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Wine</th>
            <th>Vintage</th>
            <th>Location</th>
            <th>Quantity</th>
            <th>Revision</th>
          </tr>
        </thead>

        <tbody>
          {holdings.map((holding) => (
            <tr key={holding.id}>
              <td>
                {holding.producer} — {holding.cuvee}
              </td>
              <td>{holding.vintage ?? "NV"}</td>
              <td>{holding.location_code}</td>
              <td>{holding.quantity}</td>
              <td>{holding.revision}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
