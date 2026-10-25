#!/usr/bin/env node
// Lists every translatable text in src (t("…") and tn("…", "…", n) calls with
// string literals) into src/i18n/keys.json, and says per language how many are
// still missing. `node scripts/i18n-extract.mjs --missing <code>` prints the
// missing keys of one language as JSON (to hand to a translator).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const STR = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\$]|\\.)*\x60)`;
const T = new RegExp(String.raw`(?<![\w.$])tk?\(\s*` + STR, "g");
const TN = new RegExp(String.raw`(?<![\w.$])tn\(\s*` + STR + String.raw`\s*,\s*` + STR, "g");

const unquote = (literal) => JSON.parse(`"${literal.slice(1, -1).replace(/\\'/g, "'").replace(/\\`/g, "`").replace(/(?<!\\)"/g, '\\"')}"`);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "i18n" ? [] : files(path);
    }
    return /\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

export function extract() {
  const singular = new Map();
  const plural = new Map();
  for (const file of files(src)) {
    const code = readFileSync(file, "utf8");
    const where = relative(root, file);
    for (const match of code.matchAll(TN)) {
      plural.set(unquote(match[2]), { one: unquote(match[1]), where });
    }
    for (const match of code.matchAll(T)) {
      const key = unquote(match[1]);
      if (!singular.has(key)) {
        singular.set(key, where);
      }
    }
  }
  return {
    singular: [...singular.keys()].sort(),
    plural: [...plural].map(([other, { one }]) => ({ one, other })).sort((a, b) => a.other.localeCompare(b.other)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = extract();
  writeFileSync(join(src, "i18n/keys.json"), JSON.stringify(keys, null, 1) + "\n");
  const locales = join(src, "i18n/locales");
  const missingFor = (code) => {
    const path = join(locales, `${code}.json`);
    const have = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    return {
      singular: keys.singular.filter((key) => !have[key]),
      plural: keys.plural.filter(({ other }) => !have[other]?.other),
    };
  };
  const i = process.argv.indexOf("--missing");
  if (i !== -1) {
    console.log(JSON.stringify(missingFor(process.argv[i + 1]), null, 1));
  } else {
    console.log(`${keys.singular.length} texts, ${keys.plural.length} plurals`);
    for (const name of readdirSync(locales).filter((n) => n.endsWith(".json")).sort()) {
      const missing = missingFor(name.replace(/\.json$/, ""));
      console.log(`${name}: ${missing.singular.length + missing.plural.length} missing`);
    }
  }
}
