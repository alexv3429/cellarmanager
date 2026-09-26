import { frenchText } from "./frenchText"

export const englishMessages = {
  "common.skipMain": "Skip to main content",
  "shell.sync": "Sync",
  "shell.lastCompleteSync": "Last complete sync {date}",
  "shell.syncDevice": "Sync & this device",
  "shell.activityQueue": "View activity & queued changes",
  "shell.settings": "Settings",
  "shell.personal": "Personal",
  "shell.household": "This household",
  "shell.members": "Members",
  "shell.devices": "Devices",
  "shell.signOut": "Sign out",
  "shell.owner": "Owner",
  "shell.member": "Member",
  "shell.yourHousehold": "Your household",
  "nav.primary": "Primary",
  "nav.inventory": "Inventory",
  "nav.cellar": "Cellar",
  "nav.pairing": "Pairing",
  "nav.activity": "Activity",
  "nav.catalog": "Catalog",
  "nav.data": "Data",
  "nav.setup": "Cellar setup",
  "account.back": "Back to cellar",
  "account.link": "Account",
  "account.title": "Account & profile",
  "account.intro": "Your personal account, across all your households. Owners and Members manage only their own profile and password.",
  "account.offline": "Reconnect to view or change your account. Account changes are not queued offline.",
  "account.loading": "Loading your account…",
  "account.loadError": "Unable to load your account. Check your connection or sign in again.",
  "account.reload": "Reload account",
  "account.profile": "Your profile",
  "account.email": "Sign-in email",
  "account.emailHelp": "Your email stays unchanged. It is used for sign-in, invitations and password recovery.",
  "account.displayName": "Display name",
  "account.displayNameHelp": "Shown to collaborators in every household you belong to. Leave blank to use your email. This does not change ownership or permissions.",
  "account.saveName": "Save display name",
  "account.saving": "Saving…",
  "account.nameSaved": "Display name saved. Reopen Members to see the updated name.",
  "account.language": "Language",
  "account.languageHelp": "Choose the language for this account on all your devices, or follow this browser’s preferred language.",
  "account.languageDevice": "Use browser language",
  "account.languageEnglish": "English",
  "account.languageFrench": "Français",
  "account.languageSave": "Save language",
  "account.languageSaved": "Language preference saved for your account.",
  "inventory.resultsSummary": "Showing {shownBottles} of {totalBottles} bottles · {shownWines} of {totalWines} wines · {shownPositions} of {totalPositions} positions · {pendingOperations}",
  "inventory.pendingOperationOne": "1 operation pending",
  "inventory.pendingOperationsMany": "{count} pending operations",
  "catalog.resultsSummary": "Showing {shownWines} of {totalWines} wines · {shownBottles} of {totalBottles} bottles",
  "activity.resultsSummary": "Showing {shown} of {total} latest operations. Activity is limited to the most recent 100.",
  "activity.matchingRowsSummary": "Showing {shown} of {total} rows. Ambiguous rows appear first; matching is read-only.",
  "activity.storageRowsSummary": "Showing {shown} of {total} rows. Unresolved storage and capacity warnings appear first; source context is unchanged.",
  "activity.resolvedRowsSummary": "Showing {shown} of {total} rows. Blockers and warnings appear first; details stay collapsed by default.",
  "cellar.locationFilterSummary": "Showing {shown} of {total} locations",
  "account.password": "Change password",
  "account.passwordHelp": "We will email you a secure link to choose a new password. Open it to verify that you control this account. Your current password stays unchanged until you finish.",
  "account.passwordSend": "Send password reset email",
  "account.passwordSending": "Sending…",
  "account.passwordRequested": "Email requested",
  "account.passwordSent": "Password reset email requested for {email}. Check your inbox and Spam folder. Open the newest link, set and confirm your new password, then continue to your cellar.",
  "account.passwordHint": "No email? Check Spam and wait a minute before reloading this page to retry. Your bottles, memberships and personal wine preferences are not changed.",
} as const

export type MessageKey = keyof typeof englishMessages

export const frenchMessages: Partial<Record<MessageKey, string>> = {
  "common.skipMain": "Passer au contenu principal",
  "shell.sync": "Synchronisation",
  "shell.lastCompleteSync": "Dernière synchronisation complète : {date}",
  "shell.syncDevice": "Synchronisation et appareil",
  "shell.activityQueue": "Voir l’activité et les modifications en attente",
  "shell.settings": "Paramètres",
  "shell.personal": "Personnel",
  "shell.household": "Ce foyer",
  "shell.members": "Membres",
  "shell.devices": "Appareils",
  "shell.signOut": "Se déconnecter",
  "shell.owner": "Propriétaire",
  "shell.member": "Membre",
  "shell.yourHousehold": "Votre foyer",
  "nav.primary": "Navigation principale",
  "nav.inventory": "Inventaire",
  "nav.cellar": "Cave",
  "nav.pairing": "Accords mets-vins",
  "nav.activity": "Activité",
  "nav.catalog": "Catalogue",
  "nav.data": "Données",
  "nav.setup": "Configuration de la cave",
  "account.back": "Retour à la cave",
  "account.link": "Compte",
  "account.title": "Compte et profil",
  "account.intro": "Votre compte personnel, pour tous vos foyers. Les propriétaires et membres gèrent uniquement leur propre profil et mot de passe.",
  "account.offline": "Reconnectez-vous pour consulter ou modifier votre compte. Les modifications du compte ne sont pas mises en attente hors ligne.",
  "account.loading": "Chargement de votre compte…",
  "account.loadError": "Impossible de charger votre compte. Vérifiez votre connexion ou reconnectez-vous.",
  "account.reload": "Recharger le compte",
  "account.profile": "Votre profil",
  "account.email": "Adresse e-mail de connexion",
  "account.emailHelp": "Votre adresse e-mail reste inchangée. Elle sert à la connexion, aux invitations et à la récupération du mot de passe.",
  "account.displayName": "Nom affiché",
  "account.displayNameHelp": "Visible par les personnes avec qui vous partagez une cave. Laissez vide pour afficher votre adresse e-mail. Cela ne modifie ni propriété ni autorisations.",
  "account.saveName": "Enregistrer le nom",
  "account.saving": "Enregistrement…",
  "account.nameSaved": "Nom enregistré. Rouvrez la section Membres pour voir le changement.",
  "account.language": "Langue",
  "account.languageHelp": "Choisissez la langue de ce compte sur tous vos appareils, ou utilisez la langue préférée de ce navigateur.",
  "account.languageDevice": "Utiliser la langue du navigateur",
  "account.languageEnglish": "English",
  "account.languageFrench": "Français",
  "account.languageSave": "Enregistrer la langue",
  "account.languageSaved": "Préférence de langue enregistrée pour votre compte.",
  "inventory.resultsSummary": "Affichage de {shownBottles} sur {totalBottles} bouteilles · {shownWines} sur {totalWines} vins · {shownPositions} sur {totalPositions} emplacements · {pendingOperations}",
  "inventory.pendingOperationOne": "1 opération en attente",
  "inventory.pendingOperationsMany": "{count} opérations en attente",
  "catalog.resultsSummary": "Affichage de {shownWines} sur {totalWines} vins · {shownBottles} sur {totalBottles} bouteilles",
  "activity.resultsSummary": "Affichage de {shown} sur {total} opérations les plus récentes. L’activité est limitée aux 100 dernières.",
  "activity.matchingRowsSummary": "Affichage de {shown} sur {total} lignes. Les lignes ambiguës apparaissent en premier ; l’association est en lecture seule.",
  "activity.storageRowsSummary": "Affichage de {shown} sur {total} lignes. Les emplacements non résolus et les alertes de capacité apparaissent en premier ; le contexte source reste inchangé.",
  "activity.resolvedRowsSummary": "Affichage de {shown} sur {total} lignes. Les blocages et avertissements apparaissent en premier ; les détails restent repliés par défaut.",
  "cellar.locationFilterSummary": "Affichage de {shown} sur {total} emplacements",
  "account.password": "Changer le mot de passe",
  "account.passwordHelp": "Nous vous enverrons un lien sécurisé pour choisir un nouveau mot de passe. Ouvrez-le pour vérifier que vous contrôlez ce compte. Votre mot de passe actuel reste inchangé jusqu’à la fin de la procédure.",
  "account.passwordSend": "Envoyer le lien de réinitialisation",
  "account.passwordSending": "Envoi…",
  "account.passwordRequested": "E-mail demandé",
  "account.passwordSent": "E-mail de réinitialisation demandé pour {email}. Vérifiez votre boîte de réception et les courriers indésirables. Ouvrez le lien le plus récent, définissez et confirmez votre nouveau mot de passe, puis retournez à votre cave.",
  "account.passwordHint": "Vous ne recevez pas l’e-mail ? Vérifiez les courriers indésirables et attendez une minute avant de recharger la page pour réessayer. Vos bouteilles, adhésions et préférences personnelles de vin ne sont pas modifiées.",
}

interface DynamicEnglishMessage {
  template: string
  values: Record<string, string>
}

function dynamicEnglishMessage(source: string): DynamicEnglishMessage | null {
  const calibration = source.match(/^(\d+) years? (younger|later)$/)
  if (calibration) {
    const count = Number(calibration[1])
    const direction = calibration[2]
    return {
      template: count === 1 ? `1 year ${direction}` : `{value1} years ${direction}`,
      values: { value1: String(count) },
    }
  }

  const savedPreference = source.match(/^Your private (\d+) years? (younger|later) preference now applies to every assessed wine\.$/)
  if (savedPreference) {
    const count = Number(savedPreference[1])
    const timing = `${count} ${count === 1 ? "an" : "ans"} ${savedPreference[2] === "younger" ? "plus tôt" : "plus tard"}`
    return {
      template: "Your private {value1} preference now applies to every assessed wine.",
      values: { value1: timing },
    }
  }

  const wait = source.match(/^Wait about (\d+) years before the first assessment; the likely best period starts around (\d+)\.$/)
  if (wait) {
    const years = Number(wait[1])
    return {
      template: years === 1
        ? "Wait about 1 year before the first assessment; the likely best period starts around {value1}."
        : "Wait about {value1} years before the first assessment; the likely best period starts around {value2}.",
      values: years === 1
        ? { value1: wait[2] }
        : { value1: wait[1], value2: wait[2] },
    }
  }

  const assess = source.match(/^A first bottle can be assessed now; the likely best period starts around (\d+)\.$/)
  if (assess) {
    return {
      template: "A first bottle can be assessed now; the likely best period starts around {value1}.",
      values: { value1: assess[1] },
    }
  }

  const ready = source.match(/^This wine is inside its likely best period; reassess before the suggested drink-by year of (\d+)\.$/)
  if (ready) {
    return {
      template: "This wine is inside its likely best period; reassess before the suggested drink-by year of {value1}.",
      values: { value1: ready[1] },
    }
  }

  const prioritize = source.match(/^The central estimate has passed; prioritize an assessment and aim to drink by about (\d+)\.$/)
  if (prioritize) {
    return {
      template: "The central estimate has passed; prioritize an assessment and aim to drink by about {value1}.",
      values: { value1: prioritize[1] },
    }
  }

  const personalTiming = source.match(/^Your timing: (Hold|Start assessing|Likely ready|Prioritize|Assess now)$/)
  if (personalTiming) {
    const stateLabels: Record<string, string> = {
      "Hold": "à garder",
      "Start assessing": "commencer à évaluer",
      "Likely ready": "probablement prêt",
      "Prioritize": "à prioriser",
      "Assess now": "à évaluer maintenant",
    }
    return {
      template: "Your timing: {value1}",
      values: { value1: stateLabels[personalTiming[1]] },
    }
  }

  const sync = source.match(/^(\d+) (changes?) (stored locally; synchronization resumes after reconnection|waiting for the connection|waiting for server confirmation)$/)
  if (sync) {
    const count = Number(sync[1])
    const phrase = sync[3]
    const templates: Record<string, string> = {
      "stored locally; synchronization resumes after reconnection": count === 1
        ? "1 change stored locally; synchronization resumes after reconnection"
        : "{value1} changes stored locally; synchronization resumes after reconnection",
      "waiting for the connection": count === 1
        ? "1 change waiting for the connection"
        : "{value1} changes waiting for the connection",
      "waiting for server confirmation": count === 1
        ? "1 change waiting for server confirmation"
        : "{value1} changes waiting for server confirmation",
    }
    return {
      template: templates[phrase],
      values: { value1: sync[1] },
    }
  }

  return null
}

export function translate(language: "en" | "fr", key: string, values?: Record<string, string>): string {
  const source = englishMessages[key as MessageKey] ?? key
  const dynamic = language === "fr" ? dynamicEnglishMessage(source) : null
  const template = language === "fr"
    ? frenchMessages[key as MessageKey] ?? frenchText[source] ?? (dynamic ? frenchText[dynamic.template] : undefined) ?? source
    : source
  const replacements = values ?? dynamic?.values
  return replacements ? template.replace(/\{(\w+)\}/g, (match, name: string) => replacements[name] ?? match) : template
}

export function translateSource(language: "en" | "fr", source: string): string {
  return translate(language, source)
}
