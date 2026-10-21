import React from "react";
import { Alert, Button, CircularProgress, Snackbar } from "@mui/material";
import { useMarkDoneFromLink } from "../markDoneFromLink";

const MESSAGES = {
  working: { severity: "info", text: "Marking this banner as done…" },
  "needs-auth": {
    severity: "warning",
    text: "Sign in with Bannergress to mark this banner as done.",
  },
  done: { severity: "success", text: "Marked as done." },
  error: { severity: "error", text: "Couldn't mark this banner as done." },
  unavailable: {
    severity: "warning",
    text: "Marking as done only works on openbanners.org.",
  },
};

// Feedback for /banner/{id}?markDone=1 (from the Overlay app's "Close and mark as done").
export default function MarkDoneNotice({ bannerId }) {
  const { status, signIn, retry, cancel, dismiss } = useMarkDoneFromLink(bannerId);
  const message = MESSAGES[status];

  if (!message) {
    return null;
  }

  const closable = status === "done" || status === "unavailable";
  let action = null;

  if (status === "needs-auth") {
    action = (
      <>
        <Button color="inherit" size="small" onClick={signIn}>
          Sign in
        </Button>
        <Button color="inherit" size="small" onClick={cancel}>
          Cancel
        </Button>
      </>
    );
  } else if (status === "error") {
    action = (
      <>
        <Button color="inherit" size="small" onClick={() => void retry()}>
          Retry
        </Button>
        <Button color="inherit" size="small" onClick={cancel}>
          Cancel
        </Button>
      </>
    );
  }

  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      autoHideDuration={closable ? 4000 : null}
      onClose={(event, reason) => {
        if (closable && reason !== "clickaway") {
          dismiss();
        }
      }}
    >
      <Alert
        severity={message.severity}
        icon={status === "working" ? <CircularProgress size={18} color="inherit" /> : undefined}
        onClose={closable ? dismiss : undefined}
        action={action}
        role={status === "needs-auth" || status === "error" ? "alert" : "status"}
        sx={{ width: "100%", alignItems: "center" }}
      >
        {message.text}
      </Alert>
    </Snackbar>
  );
}
