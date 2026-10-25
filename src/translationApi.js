import { call } from "./passphraseApi";

// Client for the translation part of server/passphrases.mjs (server/translations.mjs).
const base = (language) => `/translations/${encodeURIComponent(language)}`;

export const getApprovedTranslations = (language) => call(`${base(language)}/approved`, { authenticate: false });
export const getMyTranslationSuggestions = (language) => call(`${base(language)}/mine`);
export const suggestTranslation = (language, { key, form, text }) =>
  call(`${base(language)}/suggestions`, { method: "POST", body: { key, form: form || undefined, text } });

export const placeholdersOf = (text) => [...String(text ?? "").matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

// The plural forms of a language, each with a number that uses it ("few", 3).
export function pluralFormsWithExamples(language) {
  let rules;
  try {
    rules = new Intl.PluralRules(language);
  } catch {
    return [{ form: "one", example: 1 }, { form: "other", example: 2 }];
  }
  return rules.resolvedOptions().pluralCategories.map((form) => {
    let example = null;
    // Whole numbers first; some forms (Russian "other") are only for fractions.
    for (const n of [...Array(201).keys(), 1.5, 0.5, 2.5, 1.1]) {
      if (example === null && rules.select(n) === form) {
        example = n;
      }
    }
    return { form, example };
  });
}

// Every UI text as an editor row. keys: src/i18n/keys.json.
export function buildEntries(keys, language) {
  const forms = pluralFormsWithExamples(language);
  return [
    ...keys.singular.map((key) => ({ key, english: key, plural: null })),
    ...keys.plural.map(({ one, other }) => ({ key: other, english: other, plural: { one, other, forms } })),
  ].sort((a, b) => a.key.localeCompare(b.key, "en", { sensitivity: "base" }));
}

// The current text of one row (or one plural form), from the merged catalog.
export function currentText(catalog, key, form) {
  const value = catalog[key];
  if (form) {
    return value && typeof value === "object" ? value[form] || "" : "";
  }
  return typeof value === "string" ? value : "";
}

export function matchesQuery(entry, catalog, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const value = catalog[entry.key];
  const texts = [entry.key, entry.plural?.one, ...(value && typeof value === "object" ? Object.values(value) : [value])];
  return texts.some((text) => typeof text === "string" && text.toLowerCase().includes(needle));
}

export function isMissing(entry, catalog) {
  return entry.plural ? entry.plural.forms.some(({ form }) => !currentText(catalog, entry.key, form)) : !currentText(catalog, entry.key);
}
