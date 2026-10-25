import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extract } from "../../scripts/i18n-extract.mjs";
import { __setCatalogForTests, LANGUAGES, t, tn } from "./index";

const dir = resolve(__dirname, "locales");
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("translates, fills placeholders and falls back to English", () => {
    __setCatalogForTests("nl", { "Log in": "Inloggen", "{count} missions": { one: "{count} missie", other: "{count} missies" } });
    expect(t("Log in")).toBe("Inloggen");
    expect(t("Not translated {x}", { x: 1 })).toBe("Not translated 1");
    expect(tn("{count} mission", "{count} missions", 1)).toBe("1 missie");
    expect(tn("{count} mission", "{count} missions", 3)).toBe("3 missies");
    __setCatalogForTests("en", {});
    expect(tn("{count} mission", "{count} missions", 1)).toBe("1 mission");
  });

  const keys = extract();
  const singular = new Set(keys.singular);
  const plural = new Map(keys.plural.map((entry) => [entry.other, entry]));
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    it(`${file}: only known keys, same placeholders`, () => {
      const code = file.replace(/\.json$/, "");
      expect(LANGUAGES.some((language) => language.code === code)).toBe(true);
      const entries = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
      const problems = [];
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === "string") {
          if (!singular.has(key)) problems.push(`unknown key: ${key}`);
          else if (placeholders(value).join() !== placeholders(key).join()) problems.push(`placeholders differ: ${key}`);
        } else {
          if (!plural.has(key)) problems.push(`unknown plural: ${key}`);
          else if (!value.other) problems.push(`plural without other: ${key}`);
          else
            for (const form of Object.values(value))
              if (placeholders(form).join() !== placeholders(key).join()) problems.push(`placeholders differ: ${key}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
