import { useSyncExternalStore } from "react";

// OpenBanners in the user's language (Michael 2026-10-25: "We should be able to
// use OpenBanners in most common languages, should be a user setting").
//
// The English text is the key: t("Log in"), t("{count} missions", { count }).
// Plurals: tn("{count} mission", "{count} missions", count). A locale file
// (locales/<code>.json) maps the English key to its translation; plural keys
// map to { one, few, many, other } (Intl.PluralRules categories). Anything
// missing falls back to English, so a half-translated language still works.
// `npm run i18n` (scripts/i18n-extract.mjs) lists every key and what each
// language still lacks; src/i18n/i18n.test.js keeps placeholders intact.
//
// The choice is a per-device setting (localStorage), so it works logged out;
// "auto" follows the browser.

export const LANGUAGE_STORAGE_KEY = "openbanners-language";

// Most-used languages among Ingress agents, in their own names.
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "nl", name: "Nederlands" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "pl", name: "Polski" },
  { code: "cs", name: "Čeština" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "ja", name: "日本語" },
  { code: "zh-Hans", name: "简体中文" },
  { code: "zh-Hant", name: "繁體中文" },
  { code: "ko", name: "한국어" },
  { code: "id", name: "Bahasa Indonesia" },
];
const CODES = new Set(LANGUAGES.map((language) => language.code));

const loaders = import.meta.glob("./locales/*.json");

function fromBrowser() {
  const wanted = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of wanted) {
    const lower = String(tag || "").toLowerCase();
    if (lower.startsWith("zh")) {
      return /hant|tw|hk|mo/.test(lower) ? "zh-Hant" : "zh-Hans";
    }
    const base = lower.split("-")[0];
    if (CODES.has(base)) {
      return base;
    }
  }
  return "en";
}

function storedChoice() {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return value && (value === "auto" || CODES.has(value)) ? value : "auto";
  } catch {
    return "auto";
  }
}

let choice = typeof window === "undefined" ? "auto" : storedChoice();
let language = choice === "auto" ? fromBrowser() : choice;
let catalog = {};
let version = 0;
const listeners = new Set();

function emit() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

async function load(code) {
  const loader = loaders[`./locales/${code}.json`];
  const next = code === "en" || !loader ? {} : (await loader()).default;
  if (code === language) {
    catalog = next;
    if (typeof document !== "undefined") {
      document.documentElement.lang = code;
    }
    emit();
  }
}

// index.jsx waits for this before the first render, so nothing flashes in English.
export const i18nReady = typeof window !== "undefined" ? load(language).catch(() => {}) : Promise.resolve();

export function getLanguageChoice() {
  return choice;
}

export function getLanguage() {
  return language;
}

export function setLanguageChoice(next) {
  choice = next === "auto" || CODES.has(next) ? next : "auto";
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, choice);
  } catch {}
  language = choice === "auto" ? fromBrowser() : choice;
  return load(language);
}

function fill(text, vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (all, name) => (vars[name] ?? vars[name] === 0 ? String(vars[name]) : all)) : text;
}

// Marks a text for translation without translating it yet: for module-level
// constants (labels in a list), which are translated where they're shown with
// t(constant). Never call t() at module level: it runs before the language loads.
export const tk = (text) => text;

export function t(text, vars) {
  const found = catalog[text];
  return fill(typeof found === "string" && found ? found : text, vars);
}

// Plural: the English singular and plural; vars.count defaults to `count`.
export function tn(one, other, count, vars) {
  const all = { count, ...vars };
  const found = catalog[other];
  if (found && typeof found === "object") {
    const form = found[new Intl.PluralRules(language).select(count)] || found.other;
    if (form) {
      return fill(form, all);
    }
  }
  return fill(count === 1 ? one : other, all);
}

// Components can call t()/tn() directly: index.jsx remounts the app when the
// language changes. useT() is for the few places that must re-render in place.
export function useT() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version
  );
  return { t, tn, language, choice };
}

// For tests: set a catalog directly.
export function __setCatalogForTests(code, entries) {
  language = code;
  catalog = entries;
  emit();
}
