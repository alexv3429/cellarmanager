import { useEffect, useRef, useState } from "react"

import { normalizeGtin } from "../data/wineBarcodes"
import { useLanguage } from "../i18n/useLanguage"

interface WineBarcodeScannerProps {
  onScanned: (printedCode: string) => void
  onClose: () => void
}

export function WineBarcodeScanner({ onScanned, onClose }: WineBarcodeScannerProps) {
  const { t } = useLanguage()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handledRef = useRef(false)
  const [error, setError] = useState("")
  const [candidate, setCandidate] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let stop: (() => void) | null = null
    handledRef.current = false
    const video = videoRef.current
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setError(t("Camera unavailable. Enter the digits below instead."))
      return
    }
    void import("@zxing/browser")
      .then(({ BarcodeFormat, BrowserMultiFormatReader }) => {
        if (!active) return null
        const reader = new BrowserMultiFormatReader()
        // A partial EAN-13 can resemble a valid EAN-8. Bottle camera scanning
        // accepts only full-length retail codes; shorter codes remain manual.
        reader.possibleFormats = [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A]
        return reader.decodeFromVideoDevice(undefined, video, (result, _scanError, controls) => {
          if (!result || handledRef.current || !active) return
          if (result.getBarcodeFormat() !== BarcodeFormat.EAN_13 && result.getBarcodeFormat() !== BarcodeFormat.UPC_A) return
          const raw = result.getText()
          const code = normalizeGtin(raw)
          if (!code) {
            setError(t("This is not a valid EAN or UPC barcode. Try again or enter the digits."))
            return
          }
          handledRef.current = true
          controls.stop()
          setCandidate(raw)
        })
      })
      .then((controls) => {
        if (!controls) return
        if (active) stop = () => controls.stop()
        else controls.stop()
      })
      .catch(() => { if (active) setError(t("Camera unavailable. Enter the digits below instead.")) })
    return () => { active = false; stop?.() }
  }, [attempt, t])

  return (
    <section className="location-qr-scanner" aria-label={t("Scan a bottle barcode")}>
      <div className="location-qr-scanner__heading">
        <strong>{t("Point the camera at the printed bottle barcode")}</strong>
        <button type="button" className="button-secondary" onClick={onClose}>{t("Close scanner")}</button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline aria-label={t("Camera preview for bottle barcode scanning")} />
      {candidate ? <div>
        <p role="status">{t("Barcode read: {code}").replace("{code}", candidate)}</p>
        <p>{t("Check every digit against the bottle before using this code.")}</p>
        <button type="button" onClick={() => onScanned(candidate)}>{t("Use this code")}</button>
        <button type="button" className="button-secondary" onClick={() => { setCandidate(null); setError(""); setAttempt((current) => current + 1) }}>{t("Scan again")}</button>
      </div> : error ? <p role="alert">{error}</p> : <p>{t("Scan the full barcode. For an 8-digit code, enter the digits manually. Scanning never changes your cellar.")}</p>}
    </section>
  )
}
