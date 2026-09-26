import type { AppLanguage } from "./language"

export function localeForLanguage(language: AppLanguage): string {
  return language === "fr" ? "fr-FR" : "en-US"
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export function formatLocalizedDate(value: Date | string, language: AppLanguage): string {
  const date = asDate(value)
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : ""

  return new Intl.DateTimeFormat(localeForLanguage(language), {
    dateStyle: "medium",
  }).format(date)
}

export function formatLocalizedDateTime(
  value: Date | string,
  language: AppLanguage,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "medium" },
): string {
  const date = asDate(value)
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : ""

  return new Intl.DateTimeFormat(localeForLanguage(language), options).format(date)
}

export function formatLocalizedNumber(
  value: number,
  language: AppLanguage,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeForLanguage(language), options).format(value)
}
