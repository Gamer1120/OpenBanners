import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useBannerPassphrases } from "../../passphraseApi";
import { formatLength } from "../../bannerDisplay";
import { isIos } from "../../pwaInstall";
import {
  appleDirectionsUrl,
  buildWalkMissions,
  currentMissionIndex,
  doneCount,
  emptyWalkState,
  googleDirectionsUrl,
  isBannerComplete,
  missionPassphrases,
  navigateTarget,
  openMissionTap,
  PASSPHRASE_WAIT_MS,
  passphraseToCopy,
  saveWalkState,
  stepTarget,
  targetMissionIndex,
  undoWalk,
  writeClipboard,
  writeClipboardLater,
} from "../../walkMode";
import { useOncePosition, useViewportCover, useWalkBanner, useWalkState } from "./useWalk";
import { t } from "../../i18n";
import "./walk.css";

// How the tap leaves for Ingress: same tab (no target, no window.open), so
// iOS universal links / Android app links can open the Ingress app. An
// object so tests can watch it.
export const walkNavigation = {
  go(url) {
    window.location.assign(url);
  },
};

// A tap that should stay a normal link click (new tab, download, …).
const modified = (event) => event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

export default function WalkModePage() {
  useViewportCover();
  const { bannerId } = useParams();
  const { status, banner, retry } = useWalkBanner(bannerId);

  useEffect(() => {
    const previous = document.title;
    document.title = (banner?.title ? banner.title + " · " : "") + t("Walk mode") + " · OpenBanners";
    return () => {
      document.title = previous;
    };
  }, [banner?.title]);

  if (status !== "ready") {
    return (
      <div className="wk">
        <TopBar bannerId={bannerId} title={t("Walk mode")} />
        <div className="wk-center" role={status === "loading" ? "status" : "alert"}>
          {status === "loading" ? (
            t("Loading banner…")
          ) : (
            <>
              <p>{status === "notFound" ? t("Banner not found.") : t("Couldn't load this banner.")}</p>
              {status !== "notFound" ? (
                <button type="button" className="wk-link" onClick={retry}>
                  {t("Try again")}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }
  return <WalkScreen bannerId={bannerId} banner={banner} />;
}

function TopBar({ bannerId, title, sub = null, onMenu = null }) {
  return (
    <header className="wk-top">
      <Link className="wk-back" to={"/banner/" + encodeURIComponent(bannerId)} aria-label={t("Banner page")}>
        ‹
      </Link>
      <div className="wk-top-title">
        <span className="wk-top-name">{title}</span>
        {sub ? <span className="wk-top-sub">{sub}</span> : null}
      </div>
      {onMenu ? (
        <button type="button" className="wk-menu-btn" onClick={onMenu} aria-label={t("Menu")} aria-haspopup="dialog">
          ⋯
        </button>
      ) : null}
    </header>
  );
}

function WalkScreen({ bannerId, banner }) {
  const missions = useMemo(() => buildWalkMissions(banner.missions), [banner]);
  // While a tap is on its way to Ingress: { number, copied }.
  const [opening, setOpening] = useState(null);
  const openingRef = useRef(false);
  const [state, setState, stateRef] = useWalkState(bannerId, () => {
    openingRef.current = false;
    setOpening(null);
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(null); // { key, ok }

  const hasPassphrases = missions.some((mission) => mission.passphrases.length > 0);
  const answers = useBannerPassphrases(bannerId, hasPassphrases);
  // Answers not here yet (also the first render, before the request starts):
  // nothing passphrase-related is shown, so no "unknown" or guess flashes up
  // on a reload. A failed request counts as loaded (unknown).
  const answersPending = hasPassphrases && answers.status !== "error" && !answers.data;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const answerWaiters = useRef([]);
  useEffect(() => {
    if (answersPending) {
      return;
    }
    const waiters = answerWaiters.current;
    answerWaiters.current = [];
    waiters.forEach((resolve) => resolve(answersRef.current));
  }, [answersPending, answers.status, answers.data]);
  // The answers once loaded, or null after timeoutMs.
  const waitForAnswers = (timeoutMs) =>
    new Promise((resolve) => {
      answerWaiters.current.push(resolve);
      window.setTimeout(() => resolve(null), timeoutMs);
    });

  const targetIndex = targetMissionIndex(missions, state);
  const target = missions[targetIndex] ?? null;
  const current = missions[currentMissionIndex(missions, state)] ?? null;
  const complete = isBannerComplete(missions, state);
  const targetPassphrases = missionPassphrases(target, answers.byStep, answers.blocked);
  // Only for the mission you are in, and only with more than one passphrase:
  // you come back from Ingress for the second one.
  const currentRows =
    current && current.passphrases.length > 1 ? missionPassphrases(current, answers.byStep, answers.blocked) : [];
  const location = useOncePosition(Boolean(target?.start));
  const navigate = target ? navigateTarget(target, location.position) : null;

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const open = async (event) => {
    if (!target || modified(event)) {
      return;
    }
    event.preventDefault();
    if (openingRef.current) {
      return;
    }
    openingRef.current = true;
    // Tapped before the answers are here: wait for them (at most
    // PASSPHRASE_WAIT_MS), copy the real answer, never the guess.
    const tapTarget = target;
    const waitForPassphrases = answersPending
      ? waitForAnswers(PASSPHRASE_WAIT_MS).then((loaded) =>
          loaded ? missionPassphrases(tapTarget, loaded.byStep, loaded.blocked) : null
        )
      : null;
    const passphrase = passphraseToCopy(targetPassphrases);
    setOpening({ number: target.number, copied: null, copying: Boolean(passphrase), waiting: Boolean(waitForPassphrases) });
    const result = await openMissionTap({
      missions,
      state: stateRef.current,
      index: targetIndex,
      passphrases: targetPassphrases,
      waitForPassphrases,
      writeClipboard: (text) => writeClipboard(text),
      writeClipboardLater: (text) => writeClipboardLater(text),
      save: (next) => saveWalkState(bannerId, next),
      navigate: (url) => walkNavigation.go(url),
    });
    setOpening({ number: target.number, copied: result.copied, copying: false, waiting: false });
    // Still here a while later (the browser didn't leave): show the new state.
    window.setTimeout(() => {
      if (openingRef.current) {
        openingRef.current = false;
        setState(result.state);
        setOpening(null);
      }
    }, 4000);
  };

  const copyRow = async (key, text) => {
    const ok = await writeClipboard(text);
    setCopied({ key, ok });
  };

  const total = missions.length;
  const sub = t("{done} of {total} done", { done: String(doneCount(missions, state)), total: String(total) });

  return (
    <div className="wk">
      <TopBar bannerId={bannerId} title={banner.title} sub={sub} onMenu={() => setMenuOpen(true)} />
      <main className="wk-main">
        {currentRows.length ? (
          <section className="wk-rows" aria-label={t("Mission {number} passphrases", { number: String(current.number) })}>
            <h2 className="wk-rows-title">{t("Mission {number} passphrases", { number: String(current.number) })}</h2>
            <ul>
              {currentRows.map((row) => {
                const key = current.id + ":" + row.stepIndex;
                const name = row.title || t("Passphrase {number}", { number: String(row.order + 1) });
                const rowCopied = copied?.key === key ? copied : null;
                if (answersPending) {
                  // Same size as a loaded row, nothing in it yet.
                  return (
                    <li key={key} className="wk-row pending">
                      <span className="wk-row-name">{name}</span>
                      <span className="wk-row-answer" aria-hidden="true">
                        {"\u00a0"}
                      </span>
                    </li>
                  );
                }
                if (!row.known) {
                  const guessKey = key + ":guess";
                  const guessCopied = copied?.key === guessKey ? copied : null;
                  return (
                    <li key={key} className="wk-row unknown">
                      <span className="wk-row-name">{name}</span>
                      <span className="wk-row-answer">{t("Answer unknown")}</span>
                      {row.guess ? (
                        <button type="button" className="wk-link small" onClick={() => copyRow(guessKey, row.guess)}>
                          {guessCopied
                            ? guessCopied.ok
                              ? "✓ " + t("Copied")
                              : t("Couldn't copy")
                            : t("Copy {number} (guess)", { number: row.guess })}
                        </button>
                      ) : null}
                    </li>
                  );
                }
                return (
                  <li key={key}>
                    <button type="button" className={"wk-row" + (rowCopied?.ok ? " copied" : "")} onClick={() => copyRow(key, row.text)}>
                      <span className="wk-row-name">{name}</span>
                      <span className="wk-row-answer">{row.text}</span>
                      <span className="wk-row-action" aria-live="polite">
                        {rowCopied ? (rowCopied.ok ? "✓ " + t("Copied") : t("Couldn't copy")) : t("Copy")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {complete ? (
          <section className="wk-complete" role="status">
            <span className="wk-flag" aria-hidden="true">
              🏁
            </span>
            <strong>{t("Banner complete")}</strong>
            <span>{t("All {count} missions done.", { count: String(total) })}</span>
          </section>
        ) : target ? (
          <>
            <div className="wk-step">
              <button
                type="button"
                className="wk-step-btn"
                onClick={() => setState((now) => stepTarget(missions, now, -1))}
                disabled={targetIndex <= 0 || Boolean(opening)}
                aria-label={t("Previous mission")}
              >
                <span aria-hidden="true">−</span>
              </button>
              <button
                type="button"
                className="wk-step-btn"
                onClick={() => setState((now) => stepTarget(missions, now, 1))}
                disabled={targetIndex >= total - 1 || Boolean(opening)}
                aria-label={t("Next mission")}
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
            <a
              className={"wk-open" + (opening ? " opening" : "")}
              href={target.url ?? undefined}
              onClick={open}
              aria-describedby="wk-open-hint"
            >
              <span className="wk-open-label">{t("Open mission {number}", { number: String(target.number) })}</span>
              <span className="wk-open-title">{target.title}</span>
              <span className="wk-open-hint" id="wk-open-hint" aria-live="polite">
                <OpenHint passphrases={targetPassphrases} opening={opening} pending={answersPending} />
              </span>
            </a>
            {/* Always there (fixed height), so the big button doesn't change size when the guess appears. */}
            <div className="wk-guess-slot">
              {answersPending ? null : (
                <GuessButton passphrases={targetPassphrases} copied={copied} onCopy={copyRow} missionId={target.id} />
              )}
            </div>
            {/* Always there (fixed height, as tall as Navigate), so the big button keeps its size when
                "Show distance" or Navigate turns up a moment after load (permission check, position). */}
            <div className="wk-nav-slot" data-testid="wk-nav-slot">
              {navigate ? (
                <a className="wk-nav" href={isIos() ? appleDirectionsUrl(navigate.start) : googleDirectionsUrl(navigate.start)}>
                  <span aria-hidden="true">➤</span> {t("Navigate · {distance}", { distance: formatLength(navigate.distance) })}
                </a>
              ) : location.status === "ask" ? (
                <button type="button" className="wk-link" onClick={location.ask}>
                  {t("Show distance")}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </main>
      {menuOpen ? (
        <WalkMenu
          state={state}
          onClose={() => setMenuOpen(false)}
          onUndo={() => {
            setState((now) => undoWalk(now));
            setMenuOpen(false);
          }}
          onReset={() => {
            if (window.confirm(t("Reset your walk progress for this banner?"))) {
              setState(emptyWalkState());
              setMenuOpen(false);
            }
          }}
          bannerId={bannerId}
        />
      ) : null}
    </div>
  );
}

// The line under "Open mission N": what the tap copies.
function OpenHint({ passphrases, opening, pending }) {
  if (opening) {
    if (opening.waiting) {
      return t("Loading passphrases…");
    }
    if (opening.copying) {
      return t("Copying passphrase…");
    }
    return opening.copied ? "✓ " + t("Passphrase copied: {text}", { text: opening.copied }) : t("Opening Ingress…");
  }
  if (!passphrases.length) {
    return null;
  }
  if (pending) {
    // Keeps the line's height; the real hint (or "unknown") replaces it once loaded.
    return "\u00a0";
  }
  if (!passphrases[0].known) {
    return t("Passphrase answer unknown");
  }
  if (passphrases.length > 1) {
    return "🔑 " + t("Copies passphrase 1 of {count}. The others are here when you come back.", { count: String(passphrases.length) });
  }
  return "🔑 " + t("Copies the passphrase");
}

// The Overlay's fallback when no answer is known: the mission number, marked as a guess.
function GuessButton({ passphrases, copied, onCopy, missionId }) {
  const first = passphrases[0];
  if (!first || first.known || !first.guess) {
    return null;
  }
  const key = missionId + ":" + first.stepIndex + ":guess";
  const state = copied?.key === key ? copied : null;
  return (
    <button type="button" className="wk-link" onClick={() => onCopy(key, first.guess)}>
      {state ? (state.ok ? "✓ " + t("Copied") : t("Couldn't copy")) : t("Copy {number} (guess)", { number: first.guess })}
    </button>
  );
}

function WalkMenu({ state, onClose, onUndo, onReset, bannerId }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="wk-sheet-backdrop" onClick={onClose}>
      <div className="wk-sheet" role="dialog" aria-modal="true" aria-label={t("Menu")} onClick={(event) => event.stopPropagation()}>
        <div className="wk-sheet-row">
          <button type="button" className="wk-sheet-btn" onClick={onUndo} disabled={!state.history.length}>
            ↶ {t("Undo")}
          </button>
          <button type="button" className="wk-sheet-btn danger" onClick={onReset}>
            {t("Reset")}
          </button>
        </div>
        <Link className="wk-sheet-btn plain" to={"/banner/" + encodeURIComponent(bannerId)}>
          {t("Banner page")}
        </Link>
        <button type="button" className="wk-sheet-btn plain" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </div>
  );
}
