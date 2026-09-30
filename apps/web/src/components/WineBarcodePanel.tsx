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

  const lookUp = async (raw: string) => {
    const code = normalizeGtin(raw)
    if (!code) {
      setError(t("Enter a valid EAN-8, UPC-A, EAN-13, or GTIN-14 number."))
      return
    }
    setScannerOpen(false)
    setCodeInput(raw)
    setActiveCode(code)
    setLinks([])
    setProduct(null)
    setError("")
    setProviderStatus("idle")
    setLoading(true)
    const generation = ++lookupGeneration.current
    try {
      const savedLinks = await findWineBarcodeLinks(householdId, code)
      if (generation === lookupGeneration.current) setLinks(savedLinks)
    } catch {
      if (generation === lookupGeneration.current) setError(t("Could not check saved barcode links. Please try again."))
    }
    if (generation === lookupGeneration.current) setLoading(false)
  }

  const lookUpExternally = async () => {
    if (!activeCode || !isOnline) return
    setProviderStatus("loading")
    const generation = lookupGeneration.current
    try {
      const result = await lookupBarcodeProduct(activeCode)
      if (generation === lookupGeneration.current) {
        setProduct(result)
        setProviderStatus(result ? "found" : "missing")
      }
    } catch (lookupError) {
      if (generation === lookupGeneration.current) setProviderStatus(providerFailureStatus(lookupError))
    }
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
      setError(t("Could not save this barcode link. Your cellar was not changed."))
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
      setError(t("Could not remove this barcode link. Please try again."))
    } finally {
      setUnlinkingId("")
    }
  }

  return (
    <details className="wine-barcode-panel">
      <summary>{t("Find a wine by bottle barcode")}</summary>
      <p>{t("Scan the printed EAN or UPC barcode, or enter its digits. A code may be shared by several vintages, so always check the wine.")}</p>
      <div className="wine-barcode-panel__controls">
        <button type="button" className="button-secondary" disabled={loading || linking || Boolean(unlinkingId) || providerStatus === "loading"} onClick={() => setScannerOpen(true)}>{t("Scan bottle barcode")}</button>
        <label>{t("Barcode digits")}
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
        <button type="button" disabled={!isOnline || loading} onClick={() => void lookUp(codeInput)}>{loading ? t("Checking your catalogue…") : t("Find in my catalogue")}</button>
      </div>
      {scannerOpen ? <WineBarcodeScanner onClose={() => setScannerOpen(false)} onScanned={(code) => void lookUp(code)} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      {activeCode ? (
        <div className="wine-barcode-panel__results" aria-live="polite">
          <h3>{t("Barcode result")}</h3>
          <p><code>{activeCode}</code></p>
          {matchedWines.length > 0 ? (
            <section>
              <h4>{t("Linked wines in your catalogue")}</h4>
              {matchedWines.map(({ wine, link }) => <div className="wine-barcode-panel__match" key={link.id}>
                <strong>{wineLabel(wine)}</strong>
                <div>
                  <button type="button" className="button-secondary" onClick={() => onOpenWine(wine.id)}>{t("Open wine card")}</button>
                  {canManageInventory ? <button type="button" className="button-secondary" onClick={() => onUseWine(wine)}>{t("Add bottles of this wine")}</button> : null}
                  {canManageInventory ? <button type="button" className="button-secondary" disabled={unlinkingId === link.id} onClick={() => void unlink(link.id)}>{t("Remove barcode link")}</button> : null}
                </div>
              </div>)}
              {matchedWines.length > 1 ? <p>{t("Several wines share this code. Select the correct vintage and format.")}</p> : null}
            </section>
          ) : !loading ? <p>{t("No wine in your catalogue is linked to this barcode yet. A printed barcode does not identify the wine in your cellar until you associate it below.")}</p> : null}
          {isOnline && providerStatus === "idle" ? <p>{t("Optional: send only this barcode number to Open Food Facts for a product hint. No photo or cellar data is sent.")}</p> : null}
          {providerStatus === "loading" ? <p>{t("Checking Open Food Facts…")}</p> : null}
          {providerStatus === "missing" ? <p>{t("Open Food Facts has no entry for this code. You can use a label photo or enter the wine manually.")}</p> : null}
          {providerStatus === "unavailable" ? <p>{t("Open Food Facts is unavailable. Your catalogue and manual entry still work.")}</p> : null}
          {providerStatus === "session" ? <p role="alert">{t("The online lookup could not verify your session. Sign in again, then retry.")}</p> : null}
          {providerStatus === "authentication_unavailable" ? <p role="alert">{t("The sign-in service is temporarily unavailable. Please retry later.")}</p> : null}
          {providerStatus === "configuration" ? <p role="alert">{t("Online barcode lookup is not configured on this preview. Your catalogue still works.")}</p> : null}
          {providerStatus === "rate_limited" ? <p role="alert">{t("Open Food Facts is receiving too many requests. Please retry later.")}</p> : null}
          {providerStatus === "denied" ? <p role="alert">{t("Open Food Facts refused this lookup. You can still search your catalogue or add the wine manually.")}</p> : null}
          {providerStatus === "mismatch" ? <p role="alert">{t("Open Food Facts returned a different barcode, so its result was not used.")}</p> : null}
          {isOnline && providerStatus !== "loading" && providerStatus !== "found" && providerStatus !== "missing"
            ? <button type="button" className="button-secondary" onClick={() => void lookUpExternally()}>{t(providerStatus === "idle" ? "Check Open Food Facts" : "Retry Open Food Facts")}</button> : null}
          {product ? <section>
            <h4>{t("External product information — verify before use")}</h4>
            <p>{[product.brand, product.name, product.quantity].filter(Boolean).join(" · ") || t("No product details available")}</p>
            <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">{t("Source: Open Food Facts")}</a>
            <p>{t("A package barcode does not prove the vintage or exact wine. This information is not saved automatically.")}</p>
          </section> : null}
          {canManageInventory && isOnline ? <section>
            <h4>{t("Link this barcode to a wine already in your catalogue")}</h4>
            <label>{t("Search your catalogue")}
              <input value={linkSearch} onChange={(event) => { setLinkSearch(event.target.value); setSelectedWineId("") }} placeholder={t("Producer, cuvée, or appellation")} />
            </label>
            {catalogueLoading ? <p>{t("Loading your catalogue…")}</p> : null}
            {catalogueError ? <p role="alert">{t("Your catalogue could not be loaded. Please refresh before linking a barcode.")}</p> : null}
            {linkCandidates.map((wine) => <label className="wine-barcode-panel__candidate" key={wine.id}>
              <input type="radio" name="barcode-wine-link" checked={selectedWineId === wine.id} onChange={() => setSelectedWineId(wine.id)} />
              <span>{wineLabel(wine)}</span>
            </label>)}
            {!catalogueLoading && !catalogueError && normalizeSearchText(linkSearch).length >= 2 && linkCandidates.length === 0
              ? <p>{t("No matching wine in this catalogue. Check the active cellar or add the wine using the form below before linking its barcode.")}</p> : null}
            <button type="button" disabled={!selectedWineId || linking} onClick={() => void linkSelected()}>{t("Confirm barcode link")}</button>
          </section> : null}
        </div>
      ) : null}
    </details>
  )
}
