import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

let auth = { accessToken: "x" };
vi.mock("../bannergressSync", () => ({
  BANNERGRESS_AUTH_REQUEST_EVENT: "openbanners:auth-request",
  useBannergressAuth: () => auth,
  useBannergressDisplayName: (enabled) => (enabled ? "AgentAlice" : null),
}));
const createOverlayLink = vi.fn(async () => ({ code: "C".repeat(32), expiresAt: "2026-10-31T12:05:00.000Z" }));
vi.mock("../accountData", async (importOriginal) => ({ ...(await importOriginal()), createOverlayLink: (challenge) => createOverlayLink(challenge) }));

import OverlayConnectPage from "./OverlayConnectPage";

const CHALLENGE = "b".repeat(43);
const page = (search) =>
  render(
    <MemoryRouter initialEntries={[`/overlay/connect${search}`]}>
      <OverlayConnectPage />
    </MemoryRouter>
  );

describe("Connect OpenBanners Overlay", () => {
  it("asks before handing a one-time code back to the app", async () => {
    const user = userEvent.setup();
    page(`?action=restore&challenge=${CHALLENGE}&state=state-0123456789`);
    expect(screen.getByText(/wants to restore its settings/)).toBeInTheDocument();
    expect(screen.getByText("Signed in as AgentAlice")).toBeInTheDocument();
    expect(createOverlayLink).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Allow" }));
    expect(createOverlayLink).toHaveBeenCalledWith(CHALLENGE);
    const back = await screen.findByRole("link", { name: "Open the Overlay app" });
    expect(back.getAttribute("href")).toBe(`openbanners-overlay://link?code=${"C".repeat(32)}&state=state-0123456789`);
  });

  it("signed out: only a log-in button", () => {
    auth = {};
    page(`?action=backup&challenge=${CHALLENGE}&state=state-0123456789`);
    expect(screen.getByText(/wants to back up its settings/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    auth = { accessToken: "x" };
  });

  it("rejects incomplete links and explains the old-app fallback", () => {
    const { unmount } = page("?action=backup");
    expect(screen.getByRole("alert")).toHaveTextContent(/This link is incomplete/);
    unmount();
    page(`?action=backup&challenge=${CHALLENGE}&state=state-0123456789&overlay=missing`);
    expect(screen.getByRole("alert")).toHaveTextContent(/too old for this link/);
  });
});
