#!/usr/bin/env node
// Writes the translations approved in the translation editor (/translate) into
// src/i18n/locales/*.json, so they can be committed and ship with the bundle.
// The site already shows them without this (it merges the approved overrides
// over the bundled locale); this just makes them part of the source.
//
//   node scripts/i18n-apply-overrides.mjs                 # from https://openbanners.org
//   node scripts/i18n-apply-overrides.mjs --url https://test.openbanners.org
//   node scripts/i18n-apply-overrides.mjs --db /path/to/passphrases.sqlite
//   … --dry-run                                           # only show what would change
//
// Keys that are no longer in keys.json and texts whose {placeholders} differ
// from the English are skipped (and listed).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localeDir = join(root, "src/i18n/locales");
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join();

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

export function applyOverrides(entries, overrides, keys) {
  const singular = new Set(keys.singular);
  const plural = new Set(keys.plural.map((entry) => entry.other));
  const next = { ...entries };
  const changed = [];
  const skipped = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string") {
      if (!singular.has(key) || placeholders(value) !== placeholders(key)) {
        skipped.push(key);
      } else if (next[key] !== value) {
        next[key] = value;
        changed.push(key);
      }
    } else if (value && typeof value === "object") {
      const forms = Object.entries(value).filter(([, text]) => typeof text === "string" && placeholders(text) === placeholders(key));
      if (!plural.has(key) || !forms.length) {
        skipped.push(key);
        continue;
      }
      const before = next[key] && typeof next[key] === "object" ? next[key] : {};
      const merged = { ...before, ...Object.fromEntries(forms) };
      if (JSON.stringify(merged) !== JSON.stringify(before)) {
        next[key] = merged;
        changed.push(key);
      }
    }
  }
  const sorted = {};
  for (const key of Object.keys(next).sort()) {
    sorted[key] = next[key];
  }
  return { entries: sorted, changed, skipped };
}

async function overridesFromUrl(base, code) {
  const response = await fetch(`${base.replace(/\/$/, "")}/_openbanners/passphrases/v1/translations/${encodeURIComponent(code)}/approved`);
  if (response.status === 404) {
    return {};
  }
  if (!response.ok) {
    throw new Error(`${code}: HTTP ${response.status}`);
  }
  return (await response.json()).overrides ?? {};
}

async function overridesFromDb(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const { overridesAsLocale } = await import("../server/translations.mjs");
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare("SELECT language, key, form, text FROM translation_overrides ORDER BY language, key, form").all();
  db.close();
  const byLanguage = {};
  for (const row of rows) {
    (byLanguage[row.language] ??= []).push(row);
  }
  return Object.fromEntries(Object.entries(byLanguage).map(([code, list]) => [code, overridesAsLocale(list)]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const dbPath = arg("--db");
  const base = arg("--url") || "https://openbanners.org";
  const keys = JSON.parse(readFileSync(join(root, "src/i18n/keys.json"), "utf8"));
  const fromDb = dbPath ? await overridesFromDb(dbPath) : null;
  let total = 0;
  for (const name of readdirSync(localeDir).filter((file) => file.endsWith(".json")).sort()) {
    const code = name.replace(/\.json$/, "");
    const overrides = fromDb ? fromDb[code] ?? {} : await overridesFromUrl(base, code);
    if (!Object.keys(overrides).length) {
      continue;
    }
    const path = join(localeDir, name);
    const raw = readFileSync(path, "utf8");
    const { entries, changed, skipped } = applyOverrides(JSON.parse(raw), overrides, keys);
    total += changed.length;
    console.log(`${code}: ${changed.length} changed${skipped.length ? `, ${skipped.length} skipped (${skipped.join(" | ")})` : ""}`);
    if (changed.length && !dryRun) {
      writeFileSync(path, JSON.stringify(entries, null, raw.startsWith("{\n  ") ? 2 : 1) + "\n");
    }
  }
  console.log(dryRun ? `${total} would change (dry run)` : `${total} written`);
}
