import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let auth = null;
const getStatus = vi.fn();
const getCode = vi.fn();

vi.mock("../bannergressSync", async (importOriginal) => ({
  ...(await importOriginal()),
  useBannergressAuth: () => auth,
}));
vi.mock("../telegramJoin", () => ({
  getTelegramJoinStatus: () => getStatus(),
  requestTelegramJoinCode: () => getCode(),
}));

import TelegramJoinDialog from "./TelegramJoinDialog";
import { BANNERGRESS_AUTH_REQUEST_EVENT } from "../bannergressSync";

describe("Join on Telegram dialog", () => {
  beforeEach(() => {
    auth = null;
    getStatus.mockReset();
    getCode.mockReset();
  });

  it("says it isn't available while the server has no chats configured", async () => {
    getStatus.mockResolvedValue({ enabled: false, bot: "OpenBannersBot" });
    auth = { accessToken: "t" };
    render(<TelegramJoinDialog onClose={() => {}} />);
    expect(await screen.findByText(/isn’t available yet/)).toBeInTheDocument();
    expect(getCode).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /open telegram/i })).toBeNull();
  });

  it("asks to sign in with Bannergress when signed out", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const requested = vi.fn();
    window.addEventListener(BANNERGRESS_AUTH_REQUEST_EVENT, requested);
    getStatus.mockResolvedValue({ enabled: true, bot: "OpenBannersBot" });
    render(<TelegramJoinDialog onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Join on Telegram" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Sign in with Bannergress" }));
    expect(onClose).toHaveBeenCalled();
    expect(requested).toHaveBeenCalledTimes(1);
    expect(getCode).not.toHaveBeenCalled();
    window.removeEventListener(BANNERGRESS_AUTH_REQUEST_EVENT, requested);
  });

  it("signed in: fetches a code at once and links straight to the bot", async () => {
    const user = userEvent.setup();
    auth = { accessToken: "t" };
    getStatus.mockResolvedValue({ enabled: true, bot: "OpenBannersBot" });
    getCode
      .mockResolvedValueOnce({ code: "abc", bot: "OpenBannersBot", url: "https://t.me/OpenBannersBot?start=abc", expiresAt: 1 })
      .mockResolvedValueOnce({ code: "def", bot: "OpenBannersBot", url: "https://t.me/OpenBannersBot?start=def", expiresAt: 2 });
    render(<TelegramJoinDialog onClose={() => {}} />);
    const link = await screen.findByRole("link", { name: "Open Telegram" });
    expect(link).toHaveAttribute("href", "https://t.me/OpenBannersBot?start=abc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(screen.getByText(/@OpenBannersBot will send you personal invite links/)).toBeInTheDocument();
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    await user.click(screen.getByRole("button", { name: /get a new link/i }));
    expect(await screen.findByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", "https://t.me/OpenBannersBot?start=def");
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it("tells unverified agents to verify, and offers a retry on errors", async () => {
    auth = { accessToken: "t" };
    getStatus.mockResolvedValue({ enabled: true, bot: "OpenBannersBot" });
    getCode.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "not_verified" }));
    const { unmount } = render(<TelegramJoinDialog onClose={() => {}} />);
    expect(await screen.findByText(/Verify your agent name/)).toBeInTheDocument();
    unmount();
    getCode.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "bannergress_unavailable" }));
    render(<TelegramJoinDialog onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
