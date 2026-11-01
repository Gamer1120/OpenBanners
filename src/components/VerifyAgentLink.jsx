import React from "react";
import { t } from "../i18n";

// Bannergress verifies the Ingress agent name on its account page.
export const BANNERGRESS_ACCOUNT_URL = "https://bannergress.com/account";

// "Verify your agent name on Bannergress to use this.", as a link to the page
// where people verify. Use it wherever a feature needs a verified agent, and
// for the server's `not_verified` error instead of its English message.
export default function VerifyAgentLink() {
  return (
    <a className="ob-verify-agent-link" href={BANNERGRESS_ACCOUNT_URL} target="_blank" rel="noopener noreferrer">
      {t("Verify your agent name on Bannergress to use this.")}
    </a>
  );
}
