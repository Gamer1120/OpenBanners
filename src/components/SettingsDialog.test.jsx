import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const save = vi.fn(async () => ({}));
let state;
vi.mock("../passphraseApi", () => ({ useUserSettings: () => state }));
let syncState = { status: "ready", error: "" };
const removeSyncedSettings = vi.fn(async () => {});
const turnOnSettingsSync = vi.fn(async () => {});
vi.mock("../settingsSync", () => ({
  useSettingsSync: () => syncState,
  removeSyncedSettings: () => removeSyncedSettings(),
  turnOnSettingsSync: () => turnOnSettingsSync(),
}));

import SettingsDialog from "./SettingsDialog";

describe("settings", () => {
  it("switches asking after done, and confirms before blocking all my banners", async () => {
    const user = userEvent.setup();
    state = {
      status: "ready",
      loggedIn: true,
      save,
      settings: { agent: "Maker", askAfterDone: true, blockMyBanners: false, canBlockMyBanners: true },
    };
    render(<SettingsDialog onClose={() => {}} />);
    await user.click(screen.getByRole("switch", { name: /Ask after I mark a banner done/ }));
    expect(save).toHaveBeenCalledWith({ askAfterDone: false });
    await user.click(screen.getByRole("switch", { name: /Never allow passphrases for my banners/ }));
    expect(save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Delete and block" }));
    expect(save).toHaveBeenLastCalledWith({ blockMyBanners: true });
  });

  it("needs a verified agent to block, and a login for anything", () => {
    state = {
      status: "ready",
      loggedIn: true,
      save,
      settings: { agent: null, askAfterDone: true, blockMyBanners: false, canBlockMyBanners: false },
    };
    const { unmount } = render(<SettingsDialog onClose={() => {}} />);
    expect(screen.getByRole("switch", { name: /Never allow/ })).toBeDisabled();
    unmount();
    state = { status: "idle", loggedIn: false, save, settings: null };
    render(<SettingsDialog onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    // Signed out nothing syncs, and nothing can be removed.
    expect(screen.getByText(/Sign in with Bannergress to take your language/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove my synced settings" })).toBeNull();
  });

  it("removes the synced settings, and turns syncing back on", async () => {
    const user = userEvent.setup();
    state = { status: "ready", loggedIn: true, save, settings: { agent: null, askAfterDone: true, blockMyBanners: false, canBlockMyBanners: false } };
    syncState = { status: "ready", error: "" };
    const { rerender } = render(<SettingsDialog onClose={() => {}} />);
    expect(screen.getByText("Saved on this device and synced with your account.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove my synced settings" }));
    expect(removeSyncedSettings).toHaveBeenCalledTimes(1);
    syncState = { status: "off", error: "" };
    rerender(<SettingsDialog onClose={() => {}} />);
    expect(screen.getByText("Syncing is off. Your settings stay on this device only.")).toBeInTheDocument();
    expect(screen.getByText("Saved on this device.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn syncing on" }));
    expect(turnOnSettingsSync).toHaveBeenCalledTimes(1);
  });
});
