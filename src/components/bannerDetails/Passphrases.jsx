import React, { useState } from "react";
import { Check, Close, Key, Visibility } from "@mui/icons-material";
import { BANNERGRESS_AUTH_REQUEST_EVENT } from "../../bannergressSync";
import {
  authorPassphraseAction,
  stepKey,
  submitPassphrases,
  voteOnPassphrase,
} from "../../passphraseApi";

const longDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

const requestLogin = () => window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT));

// Under a passphrase waypoint: live answers behind a tap (no accidental
// spoilers), with confirm / wrong votes; pending ones say when they show.
export function WaypointAnswer({ d, missionId, stepIndex }) {
  const pass = d.passphrases;
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");
  const answers = pass?.byStep.get(stepKey(missionId, stepIndex)) ?? [];
  const live = answers.filter((answer) => answer.status === "live" && answer.answer !== null);
  const pending = answers.filter((answer) => answer.status === "pending");

  if (!live.length && !pending.length) {
    return null;
  }

  const vote = (answer, value) => {
    if (!pass.loggedIn) {
      requestLogin();
      return;
    }
    setError("");
    voteOnPassphrase(answer.id, answer.myVote === value ? null : value).then(pass.apply, (e) => setError(e.message));
  };

  return (
    <div className="wp-answer">
      {live.length && !shown ? (
        <button type="button" className="btn text sl wp-reveal" onClick={() => setShown(true)}>
          <Visibility fontSize="small" />
          Show answer{live.length > 1 ? "s" : ""}
        </button>
      ) : null}
      {shown
        ? live.map((answer) => (
            <div className="wp-ans" key={answer.id}>
              <span className="wp-ans-text">{answer.answer}</span>
              <span className="wp-ans-meta">
                {answer.source === "author" ? "From the author" : answer.kind === "number" ? "Mission number" : "Suggested"}
                {answer.confirms ? ` · ${answer.confirms} confirmed` : ""}
                {answer.wrongs ? ` · ${answer.wrongs} say it’s wrong` : ""}
              </span>
              <span className="wp-ans-votes">
                <button
                  type="button"
                  className="icon-btn sl sm"
                  aria-pressed={answer.myVote === "confirm"}
                  aria-label={`This answer is right: ${answer.answer}`}
                  title="It's right"
                  onClick={() => vote(answer, "confirm")}
                >
                  <Check />
                </button>
                <button
                  type="button"
                  className="icon-btn sl sm"
                  aria-pressed={answer.myVote === "wrong"}
                  aria-label={`This answer is wrong: ${answer.answer}`}
                  title="It's wrong"
                  onClick={() => vote(answer, "wrong")}
                >
                  <Close />
                </button>
              </span>
            </div>
          ))
        : null}
      {pending.map((answer) => (
        <div className="wp-ans-pending" key={answer.id}>
          {answer.answer !== null ? <b>{answer.answer}</b> : null}
          {answer.answer !== null ? " · " : ""}
          {d.passphrases.isAuthor
            ? "Suggested, waiting for you"
            : `Answer suggested, visible from ${longDate(answer.visibleAt)} unless the author objects`}
        </div>
      ))}
      {error ? <div className="wp-ans-pending" role="alert">{error}</div> : null}
    </div>
  );
}

// One row per passphrase waypoint: mission number, another answer, or skip.
function AnswerForm({ d, onDone }) {
  const pass = d.passphrases;
  const rows = d.passphraseMissions.flatMap((entry) =>
    entry.steps.map((stepIndex) => {
      const mission = d.missions[entry.index];
      const step = Object.values(mission?.steps ?? {})[stepIndex];
      return {
        key: stepKey(mission.id, stepIndex),
        missionId: mission.id,
        missionIndex: entry.index,
        stepIndex,
        title: step?.poi?.title || "Hidden waypoint",
        missionTitle: mission.title || `Mission ${entry.index + 1}`,
      };
    })
  );
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setChoices((current) => ({ ...current, [key]: { ...current[key], ...value } }));
  const allNumbers = () => setChoices(Object.fromEntries(rows.map((row) => [row.key, { kind: "number" }])));

  const answers = rows
    .map((row) => ({ row, choice: choices[row.key] }))
    .filter(({ choice }) => choice?.kind === "number" || (choice?.kind === "text" && choice.text?.trim()))
    .map(({ row, choice }) => ({
      missionId: row.missionId,
      stepIndex: row.stepIndex,
      kind: choice.kind,
      ...(choice.kind === "text" ? { text: choice.text.trim() } : {}),
    }));
  const textCount = answers.filter((answer) => answer.kind === "text").length;

  const send = () => {
    setBusy(true);
    setError("");
    submitPassphrases(d.items.id ?? d.bannerId, answers).then(
      (data) => {
        pass.apply(data);
        onDone(answers.length, textCount);
      },
      (e) => {
        setError(e.message);
        setBusy(false);
      }
    );
  };

  let lastMission = -1;
  return (
    <div className="pp-form">
      {rows.length > 1 ? (
        <button type="button" className="btn outlined sl" onClick={allNumbers}>
          All answers are the mission number
        </button>
      ) : null}
      <ol className="pp-rows">
        {rows.map((row) => {
          const choice = choices[row.key]?.kind ?? "";
          const heading = row.missionIndex !== lastMission;
          lastMission = row.missionIndex;
          return (
            <li key={row.key}>
              {heading ? (
                <div className="pp-mission">
                  {row.missionIndex + 1}. {row.missionTitle}
                </div>
              ) : null}
              <div className="pp-step small muted">
                Waypoint {row.stepIndex + 1}: {row.title}
              </div>
              <div className="seg pp-seg" role="group" aria-label={`Answer for mission ${row.missionIndex + 1}, waypoint ${row.stepIndex + 1}`}>
                <button type="button" aria-pressed={choice === "number"} onClick={() => set(row.key, { kind: "number" })}>
                  {row.missionIndex + 1}
                </button>
                <button type="button" aria-pressed={choice === "text"} onClick={() => set(row.key, { kind: "text" })}>
                  Other
                </button>
                <button type="button" aria-pressed={choice === ""} onClick={() => set(row.key, { kind: "" })}>
                  Skip
                </button>
              </div>
              {choice === "text" ? (
                <input
                  className="pp-input"
                  type="text"
                  maxLength={200}
                  autoComplete="off"
                  aria-label={`Answer for mission ${row.missionIndex + 1}, waypoint ${row.stepIndex + 1}`}
                  placeholder="The answer"
                  value={choices[row.key]?.text ?? ""}
                  onChange={(event) => set(row.key, { text: event.target.value })}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="small muted">
        {pass.isAuthor
          ? "You’re an author of this banner, so your answers show right away."
          : `Mission numbers show right away. Other answers show after ${pass.pendingDays} days, unless the author objects.`}
      </p>
      {error ? <p className="small pp-error" role="alert">{error}</p> : null}
      <div className="pp-actions">
        <button type="button" className="btn filled sl" disabled={busy || !answers.length} onClick={send}>
          {answers.length ? `Send ${answers.length} answer${answers.length > 1 ? "s" : ""}` : "Send answers"}
        </button>
        <button type="button" className="btn text sl" onClick={() => onDone(0, 0)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AuthorTools({ d }) {
  const pass = d.passphrases;
  const [confirming, setConfirming] = useState("");
  const [error, setError] = useState("");
  const bannerId = d.items.id ?? d.bannerId;
  const pending = (pass.data?.answers ?? []).filter((answer) => answer.status === "pending");
  const act = (action) => {
    setError("");
    authorPassphraseAction(bannerId, action).then(
      (data) => {
        pass.apply(data);
        setConfirming("");
      },
      (e) => setError(e.message)
    );
  };
  const where = (answer) => `Mission ${answer.missionIndex + 1}, waypoint ${answer.stepIndex + 1}`;

  return (
    <div className="pp-author">
      <b>You’re an author of this banner</b>
      {pending.length ? (
        <ul className="pp-pending">
          {pending.map((answer) => (
            <li key={answer.id}>
              <span className="grow">
                <span className="small muted">{where(answer)}</span>
                <br />
                {answer.answer}
                <span className="small muted"> · shows on {longDate(answer.visibleAt)}</span>
              </span>
              <button type="button" className="btn tonal sl" onClick={() => act({ action: "approve", answerId: answer.id })}>
                Publish
              </button>
              <button type="button" className="btn text sl" onClick={() => act({ action: "delete", answerId: answer.id })}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {confirming ? (
        <div className="pp-confirm" role="alertdialog" aria-label="Don't publish passphrases">
          <p className="small">
            {confirming === "all"
              ? "This deletes the answers on all your banners for good, and nobody can add new ones."
              : "This deletes the answers on this banner for good, and nobody can add new ones."}
          </p>
          <div className="pp-actions">
            <button type="button" className="btn filled sl pp-danger" onClick={() => act({ action: "object", scope: confirming })}>
              Delete and block
            </button>
            <button type="button" className="btn text sl" onClick={() => setConfirming("")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="pp-actions">
          <button type="button" className="btn outlined sl" onClick={() => setConfirming("banner")}>
            Don’t publish for this banner
          </button>
          <button type="button" className="btn outlined sl" onClick={() => setConfirming("all")}>
            Don’t publish for any of my banners
          </button>
        </div>
      )}
      {error ? <p className="small pp-error" role="alert">{error}</p> : null}
    </div>
  );
}

// In the Missions tab, under the header: what's known, and the way to add more.
export function PassphrasePanel({ d }) {
  const pass = d.passphrases;
  const [open, setOpen] = useState(false);
  const [thanks, setThanks] = useState("");
  if (d.isLoading || !d.passphraseMissions?.length || !pass || pass.status === "idle") {
    return null;
  }

  const total = d.passphraseMissions.reduce((sum, entry) => sum + entry.steps.length, 0);
  const answers = pass.data?.answers ?? [];
  const knownSteps = new Set(answers.filter((a) => a.status === "live").map((a) => stepKey(a.missionId, a.stepIndex)));
  const waiting = new Set(answers.filter((a) => a.status === "pending").map((a) => stepKey(a.missionId, a.stepIndex)));

  if (pass.blocked) {
    return (
      <section className="pp-panel" aria-label="Passphrase answers">
        <Key />
        <div className="grow small">
          {pass.blocked === "author"
            ? "The author asked not to publish passphrases for their banners."
            : "The author asked not to publish passphrases for this banner."}
          {pass.isAuthor ? (
            <button
              type="button"
              className="btn text sl"
              onClick={() =>
                authorPassphraseAction(d.items.id ?? d.bannerId, {
                  action: "unblock",
                  scope: pass.blocked === "author" ? "all" : "banner",
                }).then(pass.apply)
              }
            >
              Allow answers again
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="pp-panel" aria-label="Passphrase answers">
      <Key />
      <div className="grow">
        <b>Passphrase answers</b>
        <div className="small muted">
          {pass.status === "error"
            ? "Couldn’t load the answers."
            : pass.status === "loading" && !pass.data
              ? "Loading…"
              : `${knownSteps.size} of ${total} known${waiting.size ? ` · ${waiting.size} waiting` : ""}`}
        </div>
        {thanks ? <div className="small pp-thanks">{thanks}</div> : null}
        {open ? (
          <AnswerForm
            d={d}
            onDone={(count, textCount) => {
              setOpen(false);
              setThanks(
                !count
                  ? ""
                  : textCount && !pass.isAuthor
                    ? `Thanks! ${textCount === count ? "Your answers show" : "Mission numbers show now, the others"} after ${pass.pendingDays} days unless the author objects.`
                    : "Thanks! Your answers are visible now."
              );
            }}
          />
        ) : pass.status === "ready" ? (
          <button
            type="button"
            className="btn tonal sl pp-add"
            onClick={() => (pass.loggedIn ? setOpen(true) : requestLogin())}
          >
            {pass.loggedIn ? "Add answers" : "Log in to add answers"}
          </button>
        ) : null}
        {pass.isAuthor ? <AuthorTools d={d} /> : null}
      </div>
    </section>
  );
}
