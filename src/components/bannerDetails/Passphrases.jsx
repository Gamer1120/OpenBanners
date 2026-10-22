import React, { useState } from "react";
import { Add, Check, Close, Key, Visibility } from "@mui/icons-material";
import { BANNERGRESS_AUTH_REQUEST_EVENT } from "../../bannergressSync";
import {
  authorPassphraseAction,
  stepKey,
  submitPassphrases,
  voteOnPassphrase,
} from "../../passphraseApi";

// Flow: answers live at their own waypoint (see, confirm, add one, save as you
// go). The Missions tab card only says how many are known and asks the one
// banner-wide question that saves typing: are they all the mission number?
// Typing the mission number at a waypoint asks the same question.

const longDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

const requestLogin = () => window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT));

// Every passphrase waypoint of the banner, with whether an answer is live or waiting.
export function passphraseSlots(d) {
  const byStep = d.passphrases?.byStep ?? new Map();
  return (d.passphraseMissions ?? []).flatMap((entry) => {
    const mission = d.missions[entry.index];
    if (!mission?.id) {
      return [];
    }
    return entry.steps.map((stepIndex) => {
      const answers = byStep.get(stepKey(mission.id, stepIndex)) ?? [];
      return {
        missionId: mission.id,
        missionIndex: entry.index,
        stepIndex,
        live: answers.some((answer) => answer.status === "live"),
        pending: answers.some((answer) => answer.status === "pending"),
      };
    });
  });
}

function fillMissionNumbers(d, slots) {
  return submitPassphrases(
    d.items.id ?? d.bannerId,
    slots.map((slot) => ({ missionId: slot.missionId, stepIndex: slot.stepIndex, kind: "number" }))
  ).then(d.passphrases.apply);
}

function LiveAnswers({ d, answers }) {
  const pass = d.passphrases;
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");
  const vote = (answer, value) => {
    if (!pass.loggedIn) {
      requestLogin();
      return;
    }
    setError("");
    voteOnPassphrase(answer.id, answer.myVote === value ? null : value).then(pass.apply, (e) => setError(e.message));
  };

  if (!shown) {
    return (
      <button type="button" className="btn text sl wp-act" onClick={() => setShown(true)}>
        <Visibility fontSize="small" />
        Show answer{answers.length > 1 ? "s" : ""}
      </button>
    );
  }
  return (
    <>
      {answers.map((answer) => (
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
      ))}
      {error ? <div className="wp-ans-note" role="alert">{error}</div> : null}
    </>
  );
}

// "+ Add answer" -> one field with Save. The mission number goes live at once
// and offers to fill in the rest the same way; anything else waits.
function AddAnswer({ d, missionId, missionIndex, stepIndex }) {
  const pass = d.passphrases;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [askRest, setAskRest] = useState(false);
  const label = `Answer for mission ${missionIndex + 1}, waypoint ${stepIndex + 1}`;

  if (askRest) {
    const rest = passphraseSlots(d).filter((slot) => !slot.live && !slot.pending);
    if (!rest.length) {
      return null;
    }
    return (
      <div className="wp-ask" role="group" aria-label="Fill in the rest">
        <span className="wp-ans-note">That’s the mission number. Is every answer its mission number?</span>
        <span className="pp-actions">
          <button
            type="button"
            className="btn tonal sl"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              fillMissionNumbers(d, rest).then(
                () => setAskRest(false),
                (e) => {
                  setError(e.message);
                  setBusy(false);
                }
              );
            }}
          >
            Yes, fill in {rest.length} more
          </button>
          <button type="button" className="btn text sl" onClick={() => setAskRest(false)}>
            No
          </button>
        </span>
        {error ? <span className="wp-ans-note" role="alert">{error}</span> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn text sl wp-act"
        onClick={() => (pass.loggedIn ? setOpen(true) : requestLogin())}
      >
        <Add fontSize="small" />
        Add answer
      </button>
    );
  }

  const save = (event) => {
    event.preventDefault();
    const answer = text.trim();
    if (!answer) {
      return;
    }
    const isNumber = answer === String(missionIndex + 1);
    setBusy(true);
    setError("");
    submitPassphrases(d.items.id ?? d.bannerId, [
      { missionId, stepIndex, kind: isNumber ? "number" : "text", ...(isNumber ? {} : { text: answer }) },
    ]).then(
      (data) => {
        pass.apply(data);
        setBusy(false);
        setOpen(false);
        setText("");
        setAskRest(isNumber);
      },
      (e) => {
        setError(e.message);
        setBusy(false);
      }
    );
  };

  return (
    <form className="pp-line" onSubmit={save}>
      <input
        className="pp-input"
        type="text"
        maxLength={200}
        autoComplete="off"
        autoFocus
        aria-label={label}
        placeholder="The answer"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="btn tonal sl" disabled={busy || !text.trim()}>
        Save
      </button>
      <button
        type="button"
        className="icon-btn sl sm"
        aria-label="Cancel"
        title="Cancel"
        onClick={() => {
          setOpen(false);
          setText("");
        }}
      >
        <Close />
      </button>
      {error ? <span className="wp-ans-note pp-error" role="alert">{error}</span> : null}
    </form>
  );
}

// Under each passphrase waypoint.
export function WaypointAnswer({ d, missionId, missionIndex, stepIndex }) {
  const pass = d.passphrases;
  if (!pass || pass.status !== "ready" || pass.blocked) {
    return null;
  }
  const answers = pass.byStep.get(stepKey(missionId, stepIndex)) ?? [];
  const live = answers.filter((answer) => answer.status === "live" && answer.answer !== null);
  const pending = answers.filter((answer) => answer.status === "pending");

  return (
    <div className="wp-answer">
      {live.length ? <LiveAnswers d={d} answers={live} /> : null}
      {pending.map((answer) => (
        <div className="wp-ans-note" key={answer.id}>
          {answer.answer !== null ? <b>{answer.answer}</b> : "Answer suggested"}
          {pass.isAuthor
            ? " · waiting for you to publish it"
            : ` · visible from ${longDate(answer.visibleAt)}, unless the author objects`}
        </div>
      ))}
      {!live.length && !pending.length ? (
        <AddAnswer d={d} missionId={missionId} missionIndex={missionIndex} stepIndex={stepIndex} />
      ) : null}
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

// In the Missions tab, under the header.
export function PassphrasePanel({ d }) {
  const pass = d.passphrases;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (d.isLoading || !d.passphraseMissions?.length || !pass || pass.status === "idle") {
    return null;
  }

  const slots = passphraseSlots(d);
  const known = slots.filter((slot) => slot.live).length;
  const waiting = slots.filter((slot) => !slot.live && slot.pending).length;
  const open = slots.filter((slot) => !slot.live && !slot.pending);
  const fresh = !known && !waiting;

  if (pass.blocked) {
    return (
      <section className="pp-panel" aria-label="Passphrases">
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

  const fill = () => {
    if (!pass.loggedIn) {
      requestLogin();
      return;
    }
    setBusy(true);
    setError("");
    fillMissionNumbers(d, open).then(
      () => setBusy(false),
      (e) => {
        setError(e.message);
        setBusy(false);
      }
    );
  };

  return (
    <section className="pp-panel" aria-label="Passphrases">
      <Key />
      <div className="grow">
        <b>Passphrases</b>
        <div className="small muted">
          {pass.status === "error"
            ? "Couldn’t load the answers."
            : pass.status === "loading" && !pass.data
              ? "Loading…"
              : `${known} of ${slots.length} answer${slots.length > 1 ? "s" : ""} known${waiting ? ` · ${waiting} waiting` : ""}`}
        </div>
        {pass.status === "ready" && fresh && open.length ? (
          <div className="pp-ask">
            <span className="small">
              Is every answer its mission number? Otherwise add each answer at its waypoint.
            </span>
            <div className="pp-actions">
              <button type="button" className="btn tonal sl" disabled={busy} onClick={fill}>
                Yes, fill them in
              </button>
              <button type="button" className="btn text sl" onClick={d.showPassphrases}>
                Show the waypoints
              </button>
            </div>
          </div>
        ) : pass.status === "ready" && open.length ? (
          <div className="pp-actions">
            <button type="button" className="btn text sl pp-show" onClick={d.showPassphrases}>
              Show the {open.length} without an answer
            </button>
          </div>
        ) : null}
        {error ? <p className="small pp-error" role="alert">{error}</p> : null}
        {pass.isAuthor ? <AuthorTools d={d} /> : null}
      </div>
    </section>
  );
}
