import { useState } from "react"

import { type CurationTarget } from "../data/drinkingWindowFallbackAuthoring"
import { createCandidateRelease } from "../data/drinkingWindowProducerImport"
import { useLanguage } from "../i18n/useLanguage"
import { CurationTargetPicker } from "./CurationTargetPicker"
import { Notice } from "./Notice"

interface Props {
  candidateId: string
  expectedReviewId: string
  proposedProducer: string
  proposedCuvee: string
  vintage: number
  isOnline: boolean
  onCreated: (releaseId: string, producer: string, cuvee: string, reason: string) => void
}

export function CanonicalReleaseCreation({ candidateId, expectedReviewId, proposedProducer,
  proposedCuvee, vintage, isOnline, onCreated }: Props) {
  const { t } = useLanguage()
  const [newProducer, setNewProducer] = useState(false)
  const [newProduct, setNewProduct] = useState(false)
  const [producer, setProducer] = useState<CurationTarget | null>(null)
  const [product, setProduct] = useState<CurationTarget | null>(null)
  const [producerName, setProducerName] = useState(proposedProducer)
  const [productName, setProductName] = useState(proposedCuvee)
  const [reason, setReason] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function create() {
    setBusy(true); setError(null); setMessage(null)
    try {
      const result = await createCandidateRelease({
        candidateId, expectedReviewId,
        producerId: newProducer ? null : producer?.id ?? null,
        productId: newProducer || newProduct ? null : product?.id ?? null,
        producerName, productName, identityReason: reason, confirmed,
      })
      const resolvedProducer = newProducer ? producerName.trim() : producer!.label
      const resolvedProduct = newProducer || newProduct ? productName.trim() : product!.label
      onCreated(result.releaseId, resolvedProducer, resolvedProduct, reason.trim())
      setMessage(t("Shared wine identity ready. Its dates remain unpublished; add the proposal to a draft and review it separately."))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to create shared wine identity")
    } finally { setBusy(false) }
  }

  return <details className="drinking-window-canonical-creation">
    <summary>{t("Exact wine missing from the shared library?")}</summary>
    <p>{t("Search for an existing producer and cuvée first. Creating a shared identity is visible to other cellars, but does not link their wines or publish drinking dates.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <label><input type="checkbox" checked={newProducer} onChange={(event) => {
      setNewProducer(event.target.checked); setProducer(null); setProduct(null)
    }} />{t("This producer is absent; create it")}</label>
    {newProducer ? <label>{t("New shared producer name")}
      <input required minLength={2} maxLength={200} value={producerName}
        onChange={(event) => setProducerName(event.target.value)} />
    </label> : <CurationTargetPicker kind="producer" label={t("Existing shared producer")}
      value={producer} onChange={(next) => { setProducer(next); setProduct(null) }} isOnline={isOnline} />}
    {!newProducer ? <label><input type="checkbox" checked={newProduct} onChange={(event) => {
      setNewProduct(event.target.checked); setProduct(null)
    }} />{t("This cuvée is absent for the selected producer; create it")}</label> : null}
    {newProducer || newProduct ? <label>{t("New shared cuvée name")}
      <input required minLength={2} maxLength={200} value={productName}
        onChange={(event) => setProductName(event.target.value)} />
    </label> : <CurationTargetPicker kind="product" label={t("Existing shared cuvée")}
      value={product} onChange={setProduct} isOnline={isOnline} />}
    <p>{t("Exact vintage")}: {vintage}</p>
    <label>{t("Why are these the exact producer, cuvée and vintage?")}
      <textarea required minLength={20} maxLength={1000} value={reason}
        onChange={(event) => setReason(event.target.value)} />
    </label>
    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      {t("I checked existing identities and confirm this shared identity.")}</label>
    <button type="button" disabled={!isOnline || busy || !confirmed || reason.trim().length < 20
      || (!newProducer && !producer) || (!newProducer && !newProduct && !product)
      || (newProducer && producerName.trim().length < 2)
      || ((newProducer || newProduct) && productName.trim().length < 2)}
      onClick={() => void create()}>{busy ? t("Saving…") : t("Create or complete shared wine identity")}</button>
  </details>
}
