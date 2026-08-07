import { useQuery } from "@powersync/react"

interface CatalogWineRow {
  id: string
  producer: string
  cuvee: string
  vintage: number | null
  color: string | null
  quantity: number
}

const CATALOG_QUERY = `
  select
    w.id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color,
    coalesce(sum(h.quantity), 0) as quantity
  from wines w
  left join holdings h
    on h.wine_id = w.id
  group by
    w.id,
    w.producer,
    w.cuvee,
    w.vintage,
    w.color
  order by
    w.producer,
    w.cuvee,
    w.vintage
`

export function CatalogView() {
  const {
    data: wines,
    error,
    isLoading,
  } = useQuery<CatalogWineRow>(CATALOG_QUERY)

  return (
    <main>
      <h1>Wine catalog</h1>
      <p>
        All synchronized wines are shown here, including wines
        with no bottles currently in stock.
      </p>

      {isLoading ? <p>Opening local catalog…</p> : null}
      {error ? <p role="alert">{String(error)}</p> : null}

      {!isLoading && wines.length === 0 ? (
        <p>No synchronized wines found.</p>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Producer</th>
            <th>Cuvée</th>
            <th>Vintage</th>
            <th>Color</th>
            <th>Current bottles</th>
          </tr>
        </thead>

        <tbody>
          {wines.map((wine) => (
            <tr key={wine.id}>
              <td>{wine.producer}</td>
              <td>{wine.cuvee}</td>
              <td>{wine.vintage ?? "NV"}</td>
              <td>{wine.color ?? "—"}</td>
              <td>{wine.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
