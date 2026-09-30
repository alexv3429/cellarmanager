import { useEffect, useState } from "react"

import { encodeLocationQr } from "../data/locationQr"
import { useLanguage } from "../i18n/useLanguage"

interface LocationQrLabelProps {
  householdId: string
  locationId: string
  cellarName: string
  locationCode: string
  onClose: () => void
}

export function LocationQrLabel({ householdId, locationId, cellarName, locationCode, onClose }: LocationQrLabelProps) {
  const { t } = useLanguage()
  const [image, setImage] = useState("")
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    void import("qrcode")
      .then((qr) => qr.toString(encodeLocationQr({ householdId, locationId }), {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 4,
        width: 320,
      }))
      .then((svg) => { if (active) setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [householdId, locationId])

  return (
    <section className="location-qr-label" aria-label={t("Location QR label")}>
      <div className="location-qr-label__print">
        <strong>{cellarName}</strong>
        <span>{locationCode}</span>
        {image ? <img src={image} alt={t("QR code for this location")} /> : null}
        {error ? <p role="alert">{t("Could not create this QR code. Please try again.")}</p> : null}
        {!image && !error ? <p role="status">{t("Preparing QR code…")}</p> : null}
        <small>{t("CellarManager")}</small>
      </div>
      <p>{t("Print and attach this label to the location. Scan it inside CellarManager to select that location; the code does not grant access or change stock.")}</p>
      <div className="location-qr-label__actions">
        <button type="button" disabled={!image} onClick={() => window.print()}>{t("Print label")}</button>
        <button type="button" className="button-secondary" onClick={onClose}>{t("Close")}</button>
      </div>
    </section>
  )
}
