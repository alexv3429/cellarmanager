/**
 * Frontend i18n. Adding a language: drop a new `xx.json` file in
 * frontend/i18n/ with the same keys as en.json, and add its code to
 * SUPPORTED_LOCALES below - nothing else needs to change.
 */
import { getMeta, setMeta } from "./db.js";

export const SUPPORTED_LOCALES = ["en", "fr"];
export const DEFAULT_LOCALE = "en";

let currentLocale = DEFAULT_LOCALE;
let dictionary = {};
let fallbackDictionary = {};

/** Pure - safe to unit test without fetch/DOM. */
export function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

export function t(key, params) {
  const text = dictionary[key] || fallbackDictionary[key] || key;
  return interpolate(text, params);
}

export function getLocale() {
  return currentLocale;
}

async function fetchDictionary(locale) {
  const response = await fetch(`i18n/${locale}.json`);
  if (!response.ok) throw new Error(`Failed to load i18n/${locale}.json`);
  return response.json();
}

export async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) locale = DEFAULT_LOCALE;
  currentLocale = locale;
  try {
    dictionary = await fetchDictionary(locale);
  } catch (err) {
    console.warn("i18n: falling back to English dictionary", err);
    dictionary = {};
  }
  await setMeta("locale", locale);
  document.documentElement.lang = locale;
}

export async function initI18n() {
  fallbackDictionary = await fetchDictionary(DEFAULT_LOCALE).catch(() => ({}));
  const saved = (await getMeta("locale")) || (navigator.language || DEFAULT_LOCALE).slice(0, 2);
  await setLocale(SUPPORTED_LOCALES.includes(saved) ? saved : DEFAULT_LOCALE);
}
