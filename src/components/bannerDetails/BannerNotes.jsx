import React, { useEffect, useState } from "react";
import { EditNote } from "@mui/icons-material";
import { MAX_NOTE_LENGTH, useBannerNote } from "../../bannerNotes";

// Your own notes on a banner, only while logged in. Most banners have none, so
// without a note there is only an "Add a private note" button next to
// "View on Bannergress" (AddNoteButton); the panel shows once there is a note
// or while writing one.
export function useBannerNotes(d) {
  const bannerId = d.isLoading ? null : d.items?.id ?? d.bannerId;
  const note = useBannerNote(bannerId);
  const [draft, setDraft] = useState(null);
  useEffect(() => setDraft(null), [bannerId]);
  const ready = note.loggedIn && note.status === "ready";
  return { ...note, draft, setDraft, showPanel: ready && (Boolean(note.text) || draft !== null), canAdd: ready && !note.text && draft === null };
}

export function AddNoteButton({ notes }) {
  if (!notes.canAdd) {
    return null;
  }
  return (
    <button type="button" className="btn tonal sl bn-add" onClick={() => notes.setDraft("")}>
      <EditNote fontSize="small" />
      Add a private note
    </button>
  );
}

export default function BannerNotes({ notes }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!notes.showPanel) {
    return null;
  }
  const { draft, setDraft } = notes;
  const editing = draft !== null;
  const save = () => {
    setBusy(true);
    setError("");
    notes.save(draft).then(
      () => {
        setDraft(null);
        setBusy(false);
      },
      (e) => {
        setError(e.message);
        setBusy(false);
      }
    );
  };

  return (
    <section className="pp-panel bn-panel" aria-label="My notes">
      <EditNote />
      <div className="grow">
        <b>My notes</b>
        {editing ? (
          <>
            <textarea
              className="pp-input bn-input"
              aria-label="My notes"
              value={draft}
              maxLength={MAX_NOTE_LENGTH}
              rows={4}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="pp-actions">
              <button type="button" className="btn filled sl" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn text sl" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="bn-text">{notes.text}</p>
            <button type="button" className="btn text sl" onClick={() => setDraft(notes.text)}>
              Edit
            </button>
          </>
        )}
        <span className="small muted bn-private">Only you can see these.</span>
        {error ? <p className="small pp-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
