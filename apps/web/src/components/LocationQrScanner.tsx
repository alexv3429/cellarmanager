import { useEffect, useRef, useState } from "react"

import { parseLocationQr } from "../data/locationQr"
import { useLanguage } from "../i18n/useLanguage"

interface LocationQrScannerProps {
  householdId: string
  locationIds: readonly string[]
  onScanned: (locationId: string) => void
  onClose: () => void
}

export function LocationQrScanner({ householdId, locationIds, onScanned, onClose }: LocationQrScannerProps) {
  const { t } = useLanguage()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handledRef = useRef(false)
  const [error, setError] = useState("")
  const activeIds = useRef(locationIds)
  const onScannedRef = useRef(onScanned)

  useEffect(() => {
    activeIds.current = locationIds
    onScannedRef.current = onScanned
  }, [locationIds, onScanned])

  useEffect(() => {
    let active = true
    let stop: (() => void) | null = null
    const video = videoRef.current
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setError(t("Camera scanning is unavailable here. Select the location manually."))
      return
    }
    void import("@zxing/browser")
      .then(({ BrowserQRCodeReader }) => {
        if (!active) return null
        return new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video, (result, _scanError, controls) => {
          if (!result || handledRef.current || !active) return
          const target = parseLocationQr(result.getText())
          if (!target) {
            setError(t("This is not a CellarManager location QR code."))
            return
          }
          if (target.householdId !== householdId) {
            setError(t("This location belongs to another household. Switch households before scanning it."))
            return
          }
          if (!activeIds.current.includes(target.locationId)) {
            setError(t("This location is not available for this action."))
            return
          }
          handledRef.current = true
          controls.stop()
          onScannedRef.current(target.locationId)
        })
      })
      .then((controls) => {
        if (!controls) return
        if (active) stop = () => controls.stop()
        else controls.stop()
      })
      .catch(() => { if (active) setError(t("Camera scanning is unavailable here. Select the location manually.")) })
    return () => {
      active = false
      stop?.()
    }
  }, [householdId, t])

  return (
    <section className="location-qr-scanner" aria-label={t("Scan a location QR code")}>
      <div className="location-qr-scanner__heading">
        <strong>{t("Point the camera at a location label")}</strong>
        <button type="button" className="button-secondary" onClick={onClose}>{t("Close scanner")}</button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline aria-label={t("Camera preview for location QR scanning")} />
      {error ? <p role="alert">{error}</p> : <p>{t("Scanning only selects a location. Review any stock action before confirming it.")}</p>}
    </section>
  )
}
