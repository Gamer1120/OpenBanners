import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BannergressListActions from "./BannergressListActions";
import { BANNERGRESS_AUTH_REQUEST_EVENT, BANNERGRESS_AUTH_STORAGE_KEY } from "../bannergressSync";

describe("banner page To do / Done / Hide", () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("signed out: asks to sign in (with a Sign in button) instead of calling Bannergress", async () => {
    const user = userEvent.setup();
    const onSignInRequest = vi.fn();
    window.addEventListener(BANNERGRESS_AUTH_REQUEST_EVENT, onSignInRequest);
    render(<BannergressListActions bannerId="b1" effectiveListType={null} canUpdateBannerList layout="horizontal" />);

    await user.click(screen.getByRole("button", { name: "To do" }));

    expect(screen.getByRole("status")).toHaveTextContent("Sign in to use To do, Done and Hide.");
    expect(global.fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignInRequest).toHaveBeenCalledTimes(1);
    window.removeEventListener(BANNERGRESS_AUTH_REQUEST_EVENT, onSignInRequest);
  });

  it("signed in: no prompt, the list is updated", async () => {
    window.localStorage.setItem(
      BANNERGRESS_AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: "a",
        refreshToken: "r",
        accessExpiresAt: Date.now() + 300000,
        refreshExpiresAt: Date.now() + 1800000,
        updatedAt: Date.now(),
      })
    );
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<BannergressListActions bannerId="b1" effectiveListType={null} canUpdateBannerList layout="horizontal" />);

    await user.click(screen.getByRole("button", { name: "To do" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.bannergress.com/bnrs/b1/settings",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.queryByText("Sign in to use To do, Done and Hide.")).toBeNull();
  });
});
