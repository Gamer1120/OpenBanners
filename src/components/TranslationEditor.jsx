import React, { useEffect, useMemo, useState } from "react";
import { Edit, Search } from "@mui/icons-material";
import { BANNERGRESS_AUTH_REQUEST_EVENT, useBannergressAuth } from "../bannergressSync";
import keys from "../i18n/keys.json";
import { LANGUAGES, fetchOverrides, getLanguage, loadBundledLocale, mergeOverrides, t, tn } from "../i18n";
import {
  buildEntries,
  currentText,
  getMyTranslationSuggestions,
  isMissing,
  matchesQuery,
  placeholdersOf,
  suggestTranslation,
} from "../translationApi";
import "./TranslationEditor.css";

const PAGE = 40;
const EDITABLE = LANGUAGES.filter((language) => language.code !== "en");

// /translate: everyone can read the texts of a language next to the English;
// logged-in agents suggest better ones, which a moderator approves (Telegram bot).
export default function TranslationEditor() {
  const auth = useBannergressAuth();
  const loggedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const [language, setLanguage] = useState(() => (getLanguage() !== "en" ? getLanguage() : EDITABLE[0].code));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [state, setState] = useState({ status: "loading", catalog: {}, overrides: {} });
  const [mine, setMine] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading" }));
    Promise.all([loadBundledLocale(language), fetchOverrides(language).catch(() => ({}))]).then(
      ([bundled, overrides]) => !cancelled && setState({ status: "ready", catalog: mergeOverrides(bundled, overrides), overrides }),
      () => !cancelled && setState({ status: "error", catalog: {}, overrides: {} })
    );
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    if (!loggedIn) {
      setMine([]);
      return undefined;
    }
    let cancelled = false;
    getMyTranslationSuggestions(language).then(
      (result) => !cancelled && setMine(result.suggestions ?? []),
      () => !cancelled && setMine([])
    );
    return () => {
      cancelled = true;
    };
  }, [language, loggedIn]);

  useEffect(() => setLimit(PAGE), [language, query, filter]);

  const entries = useMemo(() => buildEntries(keys, language), [language]);
  const pendingMine = useMemo(() => {
    const map = new Map();
    for (const suggestion of mine) {
      if (suggestion.status === "pending") {
        map.set(`${suggestion.key}\u0000${suggestion.form || ""}`, suggestion.text);
      }
    }
    return map;
  }, [mine]);
  const shown = useMemo(
    () =>
      entries.filter(
        (entry) =>
          matchesQuery(entry, state.catalog, query) &&
          (filter === "all" ||
            (filter === "missing" && isMissing(entry, state.catalog)) ||
            (filter === "mine" && mine.some((suggestion) => suggestion.key === entry.key)))
      ),
    [entries, filter, mine, query, state.catalog]
  );

  const onSuggested = (suggestion) => setMine((current) => [suggestion, ...current.filter((item) => item.id !== suggestion.id)]);
  const languageName = EDITABLE.find((entry) => entry.code === language)?.name ?? language;

  return (
    <div className="ob-page te">
      <h1 className="ob-h1">{t("Translation editor")}</h1>
      <p className="small muted">
        {t("Suggest better translations for OpenBanners. A moderator checks every suggestion before everyone sees it.")}
        {loggedIn ? "" : ` ${t("Log in with Bannergress to suggest a translation.")}`}
      </p>
      <div className="te-controls">
        <select className="ob-select te-lang" aria-label={t("Language")} value={language} onChange={(event) => setLanguage(event.target.value)}>
          {EDITABLE.map((entry) => (
            <option key={entry.code} value={entry.code} lang={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
        <label className="searchbar te-search">
          <Search fontSize="small" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search texts")} aria-label={t("Search texts")} />
        </label>
      </div>
      <div className="chips te-filters" role="group" aria-label={t("Show")}>
        {[
          ["all", t("All")],
          ["missing", t("Not translated")],
          ...(loggedIn ? [["mine", t("Your suggestions")]] : []),
        ].map(([value, label]) => (
          <button key={value} type="button" className={`chip sl${filter === value ? " sel" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
        <span className="small muted te-count">{tn("{count} text", "{count} texts", shown.length)}</span>
      </div>
      {state.status === "loading" ? <p className="small muted">{t("Loading…")}</p> : null}
      {state.status === "error" ? <p className="small pp-error" role="alert">{t("Couldn’t load the translations.")}</p> : null}
      {state.status === "ready" ? (
        <>
          {!shown.length ? <p className="small muted">{t("Nothing matches your search.")}</p> : null}
          <ul className="te-list" lang={language}>
            {shown.slice(0, limit).map((entry) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                language={language}
                languageName={languageName}
                catalog={state.catalog}
                overrides={state.overrides}
                pendingMine={pendingMine}
                loggedIn={loggedIn}
                onSuggested={onSuggested}
              />
            ))}
          </ul>
          {shown.length > limit ? (
            <button type="button" className="btn tonal sl te-more" onClick={() => setLimit((value) => value + PAGE * 2)}>
              {t("Show more")}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, language, languageName, catalog, overrides, pendingMine, loggedIn, onSuggested }) {
  return (
    <li className="te-row">
      <div className="te-en" lang="en">
        <span className="te-label">{t("English")}</span>
        {entry.plural ? (
          <>
            <span className="te-text">{entry.plural.one}</span>
            <span className="te-text">{entry.plural.other}</span>
          </>
        ) : (
          <span className="te-text">{entry.english}</span>
        )}
      </div>
      {entry.plural ? (
        entry.plural.forms.map(({ form, example }) => (
          <TextLine
            key={form}
            entry={entry}
            form={form}
            label={example === null ? form : `${form} · ${t("e.g. {number}", { number: example })}`}
            english={form === "one" ? entry.plural.one : entry.plural.other}
            language={language}
            languageName={languageName}
            current={currentText(catalog, entry.key, form)}
            updated={Boolean(overrides[entry.key]?.[form])}
            pending={pendingMine.get(`${entry.key}\u0000${form}`)}
            loggedIn={loggedIn}
            onSuggested={onSuggested}
          />
        ))
      ) : (
        <TextLine
          entry={entry}
          form=""
          label={languageName}
          english={entry.english}
          language={language}
          languageName={languageName}
          current={currentText(catalog, entry.key)}
          updated={typeof overrides[entry.key] === "string"}
          pending={pendingMine.get(`${entry.key}\u0000`)}
          loggedIn={loggedIn}
          onSuggested={onSuggested}
        />
      )}
    </li>
  );
}

function TextLine({ entry, form, label, english, language, current, updated, pending, loggedIn, onSuggested }) {
  const [mode, setMode] = useState("view"); // view | edit | login | sent
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needed = placeholdersOf(entry.key);

  const open = () => {
    if (!loggedIn) {
      setMode("login");
      return;
    }
    setText(current || english);
    setError("");
    setMode("edit");
  };

  const send = (event) => {
    event.preventDefault();
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) {
      return;
    }
    if (placeholdersOf(clean).join() !== needed.join()) {
      setError(
        needed.length
          ? t("Keep these placeholders, exactly as they are: {placeholders}", { placeholders: needed.map((name) => `{${name}}`).join(" ") })
          : t("This text has no placeholders in curly brackets.")
      );
      return;
    }
    if (clean === current) {
      setError(t("That’s already the translation."));
      return;
    }
    setBusy(true);
    setError("");
    suggestTranslation(language, { key: entry.key, form, text: clean }).then(
      (result) => {
        setBusy(false);
        setMode("sent");
        onSuggested({ ...result.suggestion, form: result.suggestion.form || null });
      },
      (e) => {
        setBusy(false);
        if (e.status === 401) {
          setMode("login");
        } else {
          setError(e.message);
        }
      }
    );
  };

  return (
    <div className="te-line">
      <span className="te-label">
        {label}
        {updated ? <span className="te-updated"> · {t("updated")}</span> : null}
      </span>
      {mode === "edit" ? (
        <form className="te-form" onSubmit={send}>
          <textarea
            className="te-input"
            value={text}
            lang={language}
            rows={Math.min(6, Math.max(2, Math.ceil(text.length / 48)))}
            onChange={(event) => setText(event.target.value)}
            aria-label={t("Your translation")}
            autoFocus
          />
          {needed.length ? <span className="small muted">{t("Keep these placeholders, exactly as they are: {placeholders}", { placeholders: needed.map((name) => `{${name}}`).join(" ") })}</span> : null}
          {error ? <span className="small pp-error" role="alert">{error}</span> : null}
          <span className="te-actions">
            <button type="button" className="btn text sl" onClick={() => setMode("view")} disabled={busy}>
              {t("Cancel")}
            </button>
            <button type="submit" className="btn filled sl" disabled={busy || !text.trim()}>
              {t("Suggest")}
            </button>
          </span>
        </form>
      ) : (
        <div className="te-view">
          <span className={`te-text${current ? "" : " muted"}`}>{current || t("Not translated yet")}</span>
          <button type="button" className="icon-btn sl te-edit" aria-label={t("Suggest a translation")} title={t("Suggest a translation")} onClick={open}>
            <Edit fontSize="small" />
          </button>
        </div>
      )}
      {mode === "login" ? (
        <div className="te-note" role="status">
          <span className="small">{t("Log in with Bannergress to suggest a translation.")}</span>
          <button type="button" className="btn tonal sl" onClick={() => window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT))}>
            {t("Log in")}
          </button>
        </div>
      ) : null}
      {mode === "sent" ? (
        <p className="small te-sent" role="status">
          {t("Thanks! A moderator will check your suggestion.")}
        </p>
      ) : null}
      {pending && mode !== "edit" ? (
        <p className="small muted te-pending">{t("Your suggestion is waiting for review: {text}", { text: pending })}</p>
      ) : null}
    </div>
  );
}
