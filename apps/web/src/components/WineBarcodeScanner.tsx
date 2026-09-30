import { useEffect, useRef, useState } from "react"

import { normalizeGtin } from "../data/wineBarcodes"
import { useLanguage } from "../i18n/useLanguage"

interface WineBarcodeScannerProps {
  onScanned: (gtin14: string) => void
  onClose: () => void
}

export function WineBarcodeScanner({ onScanned, onClose }: WineBarcodeScannerProps) {
  const { t } = useLanguage()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handledRef = useRef(false)
  const onScannedRef = useRef(onScanned)
  const [error, setError] = useState("")

  useEffect(() => { onScannedRef.current = onScanned }, [onScanned])

  useEffect(() => {
    let active = true
    let stop: (() => void) | null = null
    const video = videoRef.current
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setError(t("Camera unavailable. Enter the digits below instead."))
      return
    }
    void import("@zxing/browser")
      .then(({ BrowserMultiFormatReader }) => {
        if (!active) return null
        return new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video, (result, _scanError, controls) => {
          if (!result || handledRef.current || !active) return
          const code = normalizeGtin(result.getText())
          if (!code) {
            setError(t("This is not a valid EAN or UPC barcode. Try again or enter the digits."))
            return
          }
          handledRef.current = true
          controls.stop()
          onScannedRef.current(code)
        })
      })
      .then((controls) => {
        if (!controls) return
        if (active) stop = () => controls.stop()
        else controls.stop()
      })
      .catch(() => { if (active) setError(t("Camera unavailable. Enter the digits below instead.")) })
    return () => { active = false; stop?.() }
  }, [t])

  return (
    <section className="location-qr-scanner" aria-label={t("Scan a bottle barcode")}>
      <div className="location-qr-scanner__heading">
        <strong>{t("Point the camera at the printed bottle barcode")}</strong>
        <button type="button" className="button-secondary" onClick={onClose}>{t("Close scanner")}</button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline aria-label={t("Camera preview for bottle barcode scanning")} />
      {error ? <p role="alert">{error}</p> : <p>{t("Scanning reads the code only. It never changes your cellar.")}</p>}
    </section>
  )
}
