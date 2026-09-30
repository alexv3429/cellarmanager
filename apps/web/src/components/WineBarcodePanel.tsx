import { useMemo, useRef, useState } from "react"

import { findWineBarcodeLinks, linkWineBarcode, lookupBarcodeProduct, normalizeGtin, unlinkWineBarcode, type BarcodeProduct, type WineBarcodeLink } from "../data/wineBarcodes"
import { matchesSearch, normalizeSearchText } from "../data/searchFilters"
import { formatWineVolume, type WineCatalogEntry } from "../data/wineCatalog"
import { useLanguage } from "../i18n/useLanguage"
import { WineBarcodeScanner } from "./WineBarcodeScanner"

interface WineBarcodePanelProps {
  householdId: string
  wines: readonly WineCatalogEntry[]
  isOnline: boolean
  canManageInventory: boolean
  catalogueLoading?: boolean
  catalogueError?: boolean
  onOpenWine: (wineId: string) => void
  onUseWine: (wine: WineCatalogEntry) => void
}

function wineLabel(wine: WineCatalogEntry) {
  return `${wine.producer} — ${wine.cuvee} · ${wine.vintage ?? "NV"} · ${formatWineVolume(wine.format_ml)}`
}

type ProviderStatus = "idle" | "loading" | "missing" | "unavailable" | "found" | "session" | "authentication_unavailable" | "configuration" | "rate_limited" | "denied" | "mismatch"

function providerFailureStatus(error: unknown): ProviderStatus {
  const reason = error instanceof Error ? error.message : ""
  if (reason === "barcode_authentication_required") return "session"
  if (reason === "barcode_authentication_unavailable") return "authentication_unavailable"
  if (reason === "barcode_not_configured") return "configuration"
  if (reason === "barcode_provider_rate_limited") return "rate_limited"
  if (reason === "barcode_provider_denied") return "denied"
  if (reason === "barcode_provider_mismatch") return "mismatch"
  return "unavailable"
}

export function WineBarcodePanel({ householdId, wines, isOnline, canManageInventory, catalogueLoading = false, catalogueError = false, onOpenWine, onUseWine }: WineBarcodePanelProps) {
  const { t } = useLanguage()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [codeInput, setCodeInput] = useState("")
  const [activeCode, setActiveCode] = useState("")
  const [links, setLinks] = useState<WineBarcodeLink[]>([])
  const [product, setProduct] = useState<BarcodeProduct | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>("idle")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [linkSearch, setLinkSearch] = useState("")
  const [selectedWineId, setSelectedWineId] = useState("")
  const [linking, setLinking] = useState(false)
  const [unlinkingId, setUnlinkingId] = useState("")
  const lookupGeneration = useRef(0)

  const matchedWines = useMemo(() => links.map((link) => {
    const linked = wines.find((wine) => wine.id === link.wineId)
    const current = linked?.merged_into_wine_id
      ? wines.find((wine) => wine.id === linked.merged_into_wine_id)
      : linked
    return current && !current.merged_into_wine_id ? { link, wine: current } : null
  }).filter((item): item is { link: WineBarcodeLink; wine: WineCatalogEntry } => item !== null), [links, wines])
  const linkCandidates = useMemo(() => {
    const query = normalizeSearchText(linkSearch)
    if (query.length < 2) return []
    return wines.filter((wine) => wine.household_id === householdId && !wine.merged_into_wine_id
      && matchesSearch([wine.producer, wine.cuvee, wine.appellation, wine.area, wine.vintage, wine.format_ml], query)).slice(0, 12)
  }, [householdId, linkSearch, wines])

  const checkExternally = async (code: string, generation: number) => {
    if (!isOnline) return
    setProviderStatus("loading")
    try {
      const result = await lookupBarcodeProduct(code)
      if (generation === lookupGeneration.current) {
        setProduct(result)
        setProviderStatus(result ? "found" : "missing")
      }
    } catch (lookupError) {
      if (generation === lookupGeneration.current) setProviderStatus(providerFailureStatus(lookupError))
    }
  }

  const lookUp = async (raw: string, withExternal = false) => {
    const code = normalizeGtin(raw)
    if (!code) {
      setError(t("This number does not look right. Check the digits and try again."))
      return
    }
    setScannerOpen(false)
    setCodeInput(raw)
    setActiveCode(code)
    setLinks([])
    setProduct(null)
    setError("")
    setProviderStatus(withExternal ? "loading" : "idle")
    setLoading(true)
    const generation = ++lookupGeneration.current
    try {
      const savedLinks = await findWineBarcodeLinks(householdId, code)
      if (generation === lookupGeneration.current) setLinks(savedLinks)
    } catch {
      if (generation === lookupGeneration.current) setError(t("Could not search your wines. Please try again."))
    }
    if (generation === lookupGeneration.current) setLoading(false)
    if (withExternal && generation === lookupGeneration.current) await checkExternally(code, generation)
  }

  const linkSelected = async () => {
    if (!selectedWineId || !activeCode || !canManageInventory) return
    setLinking(true)
    setError("")
    try {
      await linkWineBarcode(householdId, selectedWineId, activeCode)
      setLinks(await findWineBarcodeLinks(householdId, activeCode))
      setSelectedWineId("")
      setLinkSearch("")
    } catch {
      setError(t("Could not save this code for the wine. Nothing changed in your cellar."))
    } finally {
      setLinking(false)
    }
  }

  const unlink = async (linkId: string) => {
    setUnlinkingId(linkId)
    setError("")
    try {
      await unlinkWineBarcode(linkId)
      setLinks((current) => current.filter((link) => link.id !== linkId))
    } catch {
      setError(t("Could not remove this code from the wine. Please try again."))
    } finally {
      setUnlinkingId("")
    }
  }

  return (
    <details className="wine-barcode-panel">
      <summary>{t("Find a wine with its barcode")}</summary>
      <p>{t("Scan the barcode on the bottle or type its number. Check the wine and vintage before adding bottles.")}</p>
      <div className="wine-barcode-panel__controls">
        <button type="button" className="button-secondary" disabled={loading || linking || Boolean(unlinkingId) || providerStatus === "loading"} onClick={() => setScannerOpen(true)}>{t("Scan the barcode")}</button>
        <label>{t("Or type the number")}
          <input inputMode="numeric" autoComplete="off" disabled={loading || linking || Boolean(unlinkingId) || providerStatus === "loading"} value={codeInput} onChange={(event) => {
            lookupGeneration.current += 1
            setCodeInput(event.target.value)
            setActiveCode("")
            setLinks([])
            setProduct(null)
            setProviderStatus("idle")
            setError("")
          }} />
        </label>
        <button type="button" disabled={!isOnline || loading} onClick={() => void lookUp(codeInput)}>{loading ? t("Searching your wines…") : t("Search my wines")}</button>
        {isOnline ? <>
          <button type="button" className="button-secondary" disabled={loading || linking || Boolean(unlinkingId) || providerStatus === "loading"} onClick={() => void lookUp(codeInput, true)}>{t(providerStatus === "idle" ? "Search online" : "Try online search again")}</button>
          <p>{t("Online search is optional. Only the number is sent to Open Food Facts, not your photo or cellar details.")}</p>
        </> : null}
      </div>
      {scannerOpen ? <WineBarcodeScanner onClose={() => setScannerOpen(false)} onScanned={(code) => void lookUp(code)} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      {activeCode ? (
        <div className="wine-barcode-panel__results" aria-live="polite">
          <h3>{t("Results for this code")}</h3>
          <p><code>{codeInput.replace(/[\s-]/g, "")}</code></p>
          {matchedWines.length > 0 ? (
            <section>
              <h4>{t("Your wines")}</h4>
              {matchedWines.map(({ wine, link }) => <div className="wine-barcode-panel__match" key={link.id}>
                <strong>{wineLabel(wine)}</strong>
                <div>
                  <button type="button" className="button-secondary" onClick={() => onOpenWine(wine.id)}>{t("View this wine")}</button>
                  {canManageInventory ? <button type="button" className="button-secondary" onClick={() => onUseWine(wine)}>{t("Add bottles")}</button> : null}
                  {canManageInventory ? <button type="button" className="button-secondary" disabled={unlinkingId === link.id} onClick={() => void unlink(link.id)}>{t("Forget this code for this wine")}</button> : null}
                </div>
              </div>)}
              {matchedWines.length > 1 ? <p>{t("This code is used for several wines. Check the vintage and bottle size.")}</p> : null}
            </section>
          ) : !loading ? <p>{t("This code is not linked to any of your wines yet.")}</p> : null}
          {providerStatus === "loading" ? <p>{t("Searching online…")}</p> : null}
          {providerStatus === "missing" ? <p>{t("Nothing found online for this code. You can photograph the label or enter the wine yourself.")}</p> : null}
          {providerStatus === "unavailable" ? <p>{t("Online search is unavailable for now. You can still search your wines or add a bottle.")}</p> : null}
          {providerStatus === "session" ? <p role="alert">{t("Please sign in again to search online.")}</p> : null}
          {providerStatus === "authentication_unavailable" ? <p role="alert">{t("Online search is temporarily unavailable. Please try later.")}</p> : null}
          {providerStatus === "configuration" ? <p role="alert">{t("Online search is not available here. You can still search your wines.")}</p> : null}
          {providerStatus === "rate_limited" ? <p role="alert">{t("Online search is busy. Please try again later.")}</p> : null}
          {providerStatus === "denied" ? <p role="alert">{t("Online search could not be completed. You can still search your wines.")}</p> : null}
          {providerStatus === "mismatch" ? <p role="alert">{t("The online result did not match this code, so it was not used.")}</p> : null}
          {product ? <section>
            <h4>{t("Found online — please check")}</h4>
            <p>{[product.brand, product.name, product.quantity].filter(Boolean).join(" · ") || t("No product details available")}</p>
            <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">{t("View on Open Food Facts")}</a>
            <p>{t("The barcode may not identify the vintage. Nothing is saved automatically.")}</p>
          </section> : null}
          {canManageInventory && isOnline ? <section>
            <h4>{t("Save this code for one of your wines")}</h4>
            <p>{t("Choose the exact wine, including its vintage, before saving this code for next time.")}</p>
            <label>{t("Find a wine")}
              <input value={linkSearch} onChange={(event) => { setLinkSearch(event.target.value); setSelectedWineId("") }} placeholder={t("Name, producer, or appellation")} />
            </label>
            {catalogueLoading ? <p>{t("Loading your wines…")}</p> : null}
            {catalogueError ? <p role="alert">{t("Your wines could not be loaded. Refresh the page and try again.")}</p> : null}
            {linkCandidates.map((wine) => <label className="wine-barcode-panel__candidate" key={wine.id}>
              <input type="radio" name="barcode-wine-link" checked={selectedWineId === wine.id} onChange={() => setSelectedWineId(wine.id)} />
              <span>{wineLabel(wine)}</span>
            </label>)}
            {!catalogueLoading && !catalogueError && normalizeSearchText(linkSearch).length >= 2 && linkCandidates.length === 0
              ? <p>{t("No wine found here. Check the selected cellar, or add the wine below first.")}</p> : null}
            <button type="button" disabled={!selectedWineId || linking} onClick={() => void linkSelected()}>{t("Use this code for the selected wine")}</button>
          </section> : null}
        </div>
      ) : null}
    </details>
  )
}
