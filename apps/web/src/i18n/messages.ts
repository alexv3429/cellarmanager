import { frenchText } from "./frenchText"

export const englishMessages = {
  "common.skipMain": "Skip to main content",
  "shell.sync": "Sync",
  "shell.lastCompleteSync": "Last complete sync {date}",
  "shell.syncDevice": "Sync & this device",
  "shell.activityQueue": "View movements and synchronization",
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
  "nav.statistics": "Statistics",
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
  "activity.timelineIntro": "Confirmed wine movements and any available imported history.",
  "activity.syncIntro": "Requests awaiting confirmation, past errors, and synchronization details.",
  "activity.sections": "Activity sections",
  "activity.movementsTab": "Wine movements",
  "activity.syncTab": "Synchronization",
  "activity.importExplainer": "Imported history comes from an earlier version of CellarManager, not another cellar. These records do not change today's stock.",
  "activity.movementSearch": "Wine or location…",
  "activity.movementsSummary": "Showing {shown} of {total} movements and imported entries. Recent movements come from the latest 100 requests.",
  "activity.syncSummary": "Showing {shown} of {total} recent requests. This view is limited to the latest 100.",
  "activity.noMovements": "No confirmed wine movements or imported history found.",
  "activity.timelineSummary": "Showing {shown} of {total} activity items. Recent device activity is limited to the latest 100 operations; opening stock is grouped.",
  "activity.sourceFilter": "Status or history",
  "activity.filterTitle": "Filter activity",
  "activity.archivedBadge": "Imported history",
  "activity.openingTitle": "Imported starting stock",
  "activity.openingNotPurchase": "Starting balance from an earlier app version, not new purchases",
  "activity.openingSummary": "{bottles} {bottleWord} across {wines} {wineWord} and {positions} {positionWord}",
  "activity.openingContext": "Imported starting balance · no new stock change",
  "activity.archivedDrink": "Drank {count} {bottles}",
  "activity.fromFormerLocation": "from recorded location {location}",
  "activity.archivedContext": "Imported from an earlier app version · not replayed against current stock",
  "activity.historyLoadError": "Unable to load imported history: ",
  "activity.matchingRowsSummary": "Showing {shown} of {total} rows. Ambiguous rows appear first; matching is read-only.",
  "activity.storageRowsSummary": "Showing {shown} of {total} rows. Unresolved storage and capacity warnings appear first; source context is unchanged.",
  "activity.resolvedRowsSummary": "Showing {shown} of {total} rows. Blockers and warnings appear first; details stay collapsed by default.",
  "statistics.intro": "How your cellar stock has changed over time.",
  "statistics.overview": "At a glance",
  "statistics.period": "Period",
  "statistics.last30": "Last 30 days",
  "statistics.last12": "Last 12 months",
  "statistics.summary": "Stock summary",
  "statistics.current": "Bottles today",
  "statistics.currentHelp": "From your current inventory",
  "statistics.added": "Added",
  "statistics.removed": "Removed",
  "statistics.net": "Net change",
  "statistics.consumed": "Including {count} recorded as drunk.",
  "statistics.flowTitle": "Bottles in and out",
  "statistics.flowHelp": "Only confirmed changes. Moves between locations do not change the total. Added does not necessarily mean purchased.",
  "statistics.grouping30": "Grouped in five-day periods.",
  "statistics.grouping12": "Grouped by calendar month.",
  "statistics.noMovements": "No confirmed additions or removals in this period.",
  "statistics.addedCount": "{count} bottles added",
  "statistics.removedCount": "{count} bottles removed",
  "statistics.stockTitle": "Total bottles over time",
  "statistics.stockHelp": "From imported starting stock onward. Earlier months are omitted; the reconstruction is checked against today's inventory.",
  "statistics.stockUnavailable": "A reliable stock history is not available yet. Today's total is accurate; the changes above show confirmed movements only.",
  "statistics.tableTitle": "Show values",
  "statistics.closingStock": "Bottles at period end",
  "statistics.loading": "Loading statistics…",
  "statistics.loadError": "Statistics could not be loaded. Try again after synchronization.",
  "consumption.title": "Consumption history",
  "consumption.intro": "Bottles recorded as drunk. Gifts and other removals are not included.",
  "consumption.scopeLabel": "Consumption history period",
  "consumption.allTime": "All recorded history",
  "consumption.summary": "{bottles} bottles recorded as drunk · {wines} {wineWord}",
  "consumption.summaryOne": "{bottles} bottle recorded as drunk · {wines} {wineWord}",
  "consumption.oneWine": "wine",
  "consumption.manyWines": "wines",
  "consumption.oneBottle": "{count} bottle",
  "consumption.manyBottles": "{count} bottles",
  "consumption.unknownWine": "Wine no longer in the catalog",
  "consumption.location": "From {location}",
  "consumption.imported": "Imported history · not reapplied to today's stock",
  "consumption.empty": "No bottles recorded as drunk in this period.",
  "consumption.showMore": "Show more",
  "consumption.archiveAmbiguous": "Imported consumption history cannot be shown reliably because more than one archive is present. Recent confirmed removals are still shown.",
  "consumption.loading": "Loading consumption history…",
  "consumption.loadError": "Consumption history could not be loaded. Try again after synchronization.",
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
  "shell.activityQueue": "Voir les mouvements et la synchronisation",
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
  "nav.statistics": "Statistiques",
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
  "activity.timelineIntro": "Mouvements de vin confirmés et, s’il existe, historique importé.",
  "activity.syncIntro": "Demandes en attente, erreurs passées et détails de synchronisation.",
  "activity.sections": "Rubriques de l’activité",
  "activity.movementsTab": "Mouvements du stock",
  "activity.syncTab": "Synchronisation",
  "activity.importExplainer": "L’historique importé vient d’une ancienne version de CellarManager, pas d’une autre cave. Ces données ne modifient pas le stock actuel.",
  "activity.movementSearch": "Vin ou emplacement…",
  "activity.movementsSummary": "Affichage de {shown} sur {total} mouvements et éléments importés. Les mouvements récents proviennent des 100 dernières demandes.",
  "activity.syncSummary": "Affichage de {shown} sur {total} demandes récentes. Cette vue est limitée aux 100 dernières.",
  "activity.noMovements": "Aucun mouvement de vin confirmé ni historique importé.",
  "activity.timelineSummary": "Affichage de {shown} sur {total} éléments d’activité. Les mouvements des appareils sont limités aux 100 dernières opérations ; le stock initial est regroupé.",
  "activity.sourceFilter": "Statut ou historique",
  "activity.filterTitle": "Filtrer l’activité",
  "activity.archivedBadge": "Historique importé",
  "activity.openingTitle": "Stock de départ importé",
  "activity.openingNotPurchase": "Solde de départ de l’ancienne version, pas de nouveaux achats",
  "activity.openingSummary": "{bottles} {bottleWord} pour {wines} {wineWord} et {positions} {positionWord}",
  "activity.openingContext": "Solde de départ importé · aucun nouveau mouvement de stock",
  "activity.archivedDrink": "Bu {count} {bottles}",
  "activity.fromFormerLocation": "depuis l’emplacement consigné {location}",
  "activity.archivedContext": "Importé depuis une ancienne version · non rejoué sur le stock actuel",
  "activity.historyLoadError": "Impossible de charger l’historique importé : ",
  "activity.matchingRowsSummary": "Affichage de {shown} sur {total} lignes. Les lignes ambiguës apparaissent en premier ; l’association est en lecture seule.",
  "activity.storageRowsSummary": "Affichage de {shown} sur {total} lignes. Les emplacements non résolus et les alertes de capacité apparaissent en premier ; le contexte source reste inchangé.",
  "activity.resolvedRowsSummary": "Affichage de {shown} sur {total} lignes. Les blocages et avertissements apparaissent en premier ; les détails restent repliés par défaut.",
  "statistics.intro": "L’évolution du stock de votre cave dans le temps.",
  "statistics.overview": "Vue d’ensemble",
  "statistics.period": "Période",
  "statistics.last30": "30 derniers jours",
  "statistics.last12": "12 derniers mois",
  "statistics.summary": "Résumé du stock",
  "statistics.current": "Bouteilles aujourd’hui",
  "statistics.currentHelp": "D’après l’inventaire actuel",
  "statistics.added": "Ajoutées",
  "statistics.removed": "Retirées",
  "statistics.net": "Variation nette",
  "statistics.consumed": "Dont {count} déclarées bues.",
  "statistics.flowTitle": "Entrées et sorties de bouteilles",
  "statistics.flowHelp": "Uniquement les mouvements confirmés. Les déplacements entre emplacements ne changent pas le total. Un ajout n’est pas forcément un achat.",
  "statistics.grouping30": "Regroupement par périodes de cinq jours.",
  "statistics.grouping12": "Regroupement par mois calendaire.",
  "statistics.noMovements": "Aucun ajout ni retrait confirmé sur cette période.",
  "statistics.addedCount": "{count} bouteilles ajoutées",
  "statistics.removedCount": "{count} bouteilles retirées",
  "statistics.stockTitle": "Nombre total de bouteilles dans le temps",
  "statistics.stockHelp": "À partir du stock initial importé. Les mois précédents sont omis ; la reconstitution est vérifiée avec l’inventaire actuel.",
  "statistics.stockUnavailable": "L’historique ne permet pas encore de tracer une courbe fiable. Le total actuel est exact ; les variations ci-dessus montrent uniquement les mouvements confirmés.",
  "statistics.tableTitle": "Afficher les valeurs",
  "statistics.closingStock": "Bouteilles en fin de période",
  "statistics.loading": "Chargement des statistiques…",
  "statistics.loadError": "Impossible de charger les statistiques. Réessayez après la synchronisation.",
  "consumption.title": "Historique de consommation",
  "consumption.intro": "Bouteilles déclarées bues. Les cadeaux et autres retraits ne sont pas comptés.",
  "consumption.scopeLabel": "Période de l’historique de consommation",
  "consumption.allTime": "Tout l’historique enregistré",
  "consumption.summary": "{bottles} bouteilles déclarées bues · {wines} {wineWord}",
  "consumption.summaryOne": "{bottles} bouteille déclarée bue · {wines} {wineWord}",
  "consumption.oneWine": "vin",
  "consumption.manyWines": "vins",
  "consumption.oneBottle": "{count} bouteille",
  "consumption.manyBottles": "{count} bouteilles",
  "consumption.unknownWine": "Vin absent du catalogue actuel",
  "consumption.location": "Depuis {location}",
  "consumption.imported": "Historique importé · sans effet sur le stock actuel",
  "consumption.empty": "Aucune bouteille déclarée bue sur cette période.",
  "consumption.showMore": "Afficher la suite",
  "consumption.archiveAmbiguous": "L’historique importé ne peut pas être affiché de manière fiable car plusieurs archives sont présentes. Les retraits récents confirmés restent visibles.",
  "consumption.loading": "Chargement de l’historique de consommation…",
  "consumption.loadError": "Impossible de charger l’historique de consommation. Réessayez après la synchronisation.",
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
