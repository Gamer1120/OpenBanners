import React from "react";
import { render, screen, within } from "@testing-library/react";
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

const accountData = {
  getExportStatus: vi.fn(async () => ({ lastExportAt: null, nextExportAt: null })),
  downloadMyData: vi.fn(async () => ({ nextExportAt: "2026-10-31T13:00:00.000Z" })),
  getOverlayBackup: vi.fn(async () => ({ backup: { createdAt: "2026-10-30T09:15:00.000Z", appVersion: 51, settings: {} } })),
  deleteOverlayBackup: vi.fn(async () => ({ backup: null })),
};
vi.mock("../accountData", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getExportStatus: () => accountData.getExportStatus(),
    downloadMyData: () => accountData.downloadMyData(),
    getOverlayBackup: () => accountData.getOverlayBackup(),
    deleteOverlayBackup: () => accountData.deleteOverlayBackup(),
  };
});

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

  it("downloads my data, and says when the next one is possible after a refusal", async () => {
    const user = userEvent.setup();
    state = { status: "ready", loggedIn: true, save, settings: { agent: null, askAfterDone: true, blockMyBanners: false, canBlockMyBanners: false } };
    syncState = { status: "ready", error: "" };
    render(<SettingsDialog onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Download my data" }));
    expect(accountData.downloadMyData).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Your data was downloaded.")).toBeInTheDocument();
    expect(screen.getByText(/You can download your data once an hour\. Next possible at/)).toBeInTheDocument();
    accountData.downloadMyData.mockRejectedValueOnce(
      Object.assign(new Error("You can download your data once an hour."), { code: "export_limit", status: 429, data: { nextExportAt: "2026-10-31T13:00:00.000Z" } })
    );
    await user.click(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/once an hour\. Next possible at/);
  });

  it("shows the Overlay backup's date and deletes it after confirming", async () => {
    const user = userEvent.setup();
    state = { status: "ready", loggedIn: true, save, settings: { agent: null, askAfterDone: true, blockMyBanners: false, canBlockMyBanners: false } };
    render(<SettingsDialog onClose={() => {}} />);
    expect(await screen.findByText(/Last backup: .*2026.*\(app version 51\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(accountData.deleteOverlayBackup).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "Delete the Overlay backup?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(accountData.deleteOverlayBackup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/No backup yet/)).toBeInTheDocument();
  });

  it("signed out: no data actions", () => {
    state = { status: "idle", loggedIn: false, save, settings: null };
    render(<SettingsDialog onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Download my data" })).toBeNull();
    expect(screen.getByText(/Sign in with Bannergress to download your data/)).toBeInTheDocument();
  });
});
