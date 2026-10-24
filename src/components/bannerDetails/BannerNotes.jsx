import React, { useEffect, useState } from "react";
import { EditNote } from "@mui/icons-material";
import { MAX_NOTE_LENGTH, useBannerNote } from "../../bannerNotes";

// Your own notes on a banner: only while logged in, and only you see them.
export default function BannerNotes({ d }) {
  const bannerId = d.items?.id ?? d.bannerId;
  const note = useBannerNote(d.isLoading ? null : bannerId);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setDraft(null), [bannerId]);

  // A failed load stays quiet: notes are a side feature.
  if (!note.loggedIn || note.status !== "ready") {
    return null;
  }
  const editing = draft !== null;
  // Most banners have no note: then only a small link, no panel.
  if (!note.text && !editing) {
    return (
      <button type="button" className="btn text sl bn-add" onClick={() => setDraft("")}>
        <EditNote fontSize="small" />
        Add a private note
      </button>
    );
  }
  const save = () => {
    setBusy(true);
    setError("");
    note.save(draft).then(
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
            <p className="bn-text">{note.text}</p>
            <button type="button" className="btn text sl" onClick={() => setDraft(note.text)}>
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
