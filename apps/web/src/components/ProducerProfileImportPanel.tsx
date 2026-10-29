import { useEffect, useState } from "react"

import {
  getProducerProfileImports,
  previewProducerResearchPackage,
  submitProducerResearchPackage,
  type ProducerImportPreview,
  type ProducerImportRecord,
} from "../data/drinkingWindowProducerImport"
import { useLanguage } from "../i18n/useLanguage"
import { Notice } from "./Notice"

interface FilePreview {
  name: string
  contents: string
  preview: ProducerImportPreview
}

interface Props {
  isOnline: boolean
  selectedHash: string | null
  onSelect: (hash: string | null) => void
}

export function ProducerProfileImportPanel({ isOnline, selectedHash, onSelect }: Props) {
  const { t } = useLanguage()
  const [imports, setImports] = useState<ProducerImportRecord[]>([])
  const [files, setFiles] = useState<FilePreview[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refresh() {
    if (!isOnline) return
    setImports(await getProducerProfileImports())
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    void getProducerProfileImports().then((next) => {
      if (!cancelled) setImports(next)
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load imports")
    })
    return () => { cancelled = true }
  }, [isOnline])

  async function choose(selected: FileList | null) {
    if (!selected?.length) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const next: FilePreview[] = []
      for (const file of Array.from(selected)) {
        if (file.size > 2_000_000) throw new Error(`${file.name}: file exceeds 2 MB`)
        const contents = await file.text()
        const preview = previewProducerResearchPackage(JSON.parse(contents) as unknown)
        next.push({ name: file.name, contents, preview })
      }
      setFiles(next)
    } catch (caught: unknown) {
      setFiles([])
      setError(caught instanceof Error ? caught.message : "Invalid producer profile")
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!isOnline || !files.length) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      let inserted = 0
      let firstHash: string | null = null
      for (const file of files) {
        const result = await submitProducerResearchPackage(file.contents)
        const response = result.response as Record<string, unknown>
        inserted += typeof response?.inserted === "number" ? response.inserted : 0
        firstHash ??= result.digest
      }
      setFiles([])
      await refresh()
      if (firstHash) onSelect(firstHash)
      setMessage(t("{count} research proposals added to the review queue. No dates were published.", {
        count: String(inserted),
      }))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to import producer profiles")
      await refresh().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  return <section className="drinking-window-profile-import">
    <h3>{t("Producer research profiles")}</h3>
    <p>{t("Load version 1.1 JSON files into the review queue. Importing never approves or publishes a drinking window; each release, source and reuse right still needs review.")}</p>
    {error ? <Notice role="alert" tone="warning">{error}</Notice> : null}
    {message ? <Notice role="status" tone="success">{message}</Notice> : null}
    <label>{t("Choose producer profile files")}
      <input type="file" accept=".json,application/json" multiple disabled={!isOnline || busy}
        onChange={(event) => void choose(event.target.files)} />
    </label>
    {files.length ? <div>
      <p>{t("Ready for research review; not approved advice")}</p>
      <ul>{files.map((file) => <li key={file.name}>
        {file.preview.producer} · {file.preview.datasetVersion} · {file.preview.candidates.length} {t("release proposals")}
      </li>)}</ul>
      <button type="button" disabled={!isOnline || busy} onClick={() => void submit()}>
        {busy ? t("Importing…") : t("Add to review queue")}
      </button>
    </div> : null}
    <label>{t("Review an imported producer profile")}
      <select value={selectedHash ?? ""} disabled={!isOnline || busy}
        onChange={(event) => onSelect(event.target.value || null)}>
        <option value="">{t("All recent candidates")}</option>
        {imports.map((item) => <option key={item.packageSha256} value={item.packageSha256}>
          {item.producer} · {item.datasetVersion} · {item.candidateCount}
        </option>)}
      </select>
    </label>
  </section>
}
