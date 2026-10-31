import { DrinkingWindowReviewWorkspace } from "./DrinkingWindowReviewWorkspace"
import { Notice } from "./Notice"
import { useLanguage } from "../i18n/useLanguage"

interface SharedReferenceAdminViewProps {
  accessChecked: boolean
  canCurate: boolean
  householdId: string
  isOnline: boolean
  onBackToCatalog: () => void
}

export function SharedReferenceAdminView({
  accessChecked,
  canCurate,
  householdId,
  isOnline,
  onBackToCatalog,
}: SharedReferenceAdminViewProps) {
  const { t } = useLanguage()

  return <main className="shared-reference-admin">
    <button type="button" onClick={onBackToCatalog}>{t("Back to catalogue")}</button>
    <h1>{t("Shared database administration")}</h1>
    <p>{t("Review shared profiles and proposals here. This does not change your cellar until you explicitly adopt published dates.")}</p>
    {!isOnline ? <Notice tone="warning">{t("Reconnect to review the shared database.")}</Notice> : null}
    {isOnline && !accessChecked ? <Notice>{t("Checking curator access…")}</Notice> : null}
    {isOnline && accessChecked && !canCurate ? <Notice tone="warning">{t("This page is available only to people authorized to review the shared database.")}</Notice> : null}
    {canCurate ? <>
      <DrinkingWindowReviewWorkspace householdId={householdId} isOnline={isOnline} />
    </> : null}
  </main>
}
