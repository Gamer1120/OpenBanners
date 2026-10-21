import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  clearBannergressAuthData,
  clearBannergressSyncData,
  getBannerListType,
  loadBannergressSyncData,
  saveBannergressAuthData,
} from "./bannergressSync";
import {
  MARK_DONE_PENDING_MAX_AGE_MS,
  MARK_DONE_PENDING_STORAGE_KEY,
  hasPendingMarkDone,
  isMarkDoneRequested,
  savePendingMarkDone,
  stripMarkDoneParam,
} from "./markDoneFromLink";
import MarkDoneNotice from "./components/MarkDoneNotice";

function CurrentUrl() {
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function BannerPage() {
  const location = useLocation();
  const bannerId = location.pathname.split("/")[2];
  return (
    <>
      <CurrentUrl />
      <MarkDoneNotice bannerId={bannerId} />
    </>
  );
}

function renderBannerPage(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/banner/:bannerId" element={<BannerPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function signIn() {
  saveBannergressAuthData({ accessToken: "fresh-token", updatedAt: Date.now() });
}

function mockSettingsApi(status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.sessionStorage.clear();
  clearBannergressAuthData();
  clearBannergressSyncData();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("reads and strips the markDone parameter", () => {
  expect(isMarkDoneRequested("?markDone=1")).toBe(true);
  expect(isMarkDoneRequested("?markDone=true&x=1")).toBe(true);
  expect(isMarkDoneRequested("?markDone=0")).toBe(false);
  expect(isMarkDoneRequested("")).toBe(false);
  expect(stripMarkDoneParam("?markDone=1")).toBe("");
  expect(stripMarkDoneParam("?tab=map&markDone=1")).toBe("?tab=map");
});

test("a pending mark-done is per banner and expires", () => {
  savePendingMarkDone("banner-a", 1000);
  expect(hasPendingMarkDone("banner-a", 1000)).toBe(true);
  expect(hasPendingMarkDone("banner-b", 1000)).toBe(false);
  expect(hasPendingMarkDone("banner-a", 1000 + MARK_DONE_PENDING_MAX_AGE_MS + 1)).toBe(false);
});

test("signed in: marks the banner as done, updates the list colour and strips the parameter", async () => {
  signIn();
  const fetchMock = mockSettingsApi();

  renderBannerPage("/banner/my-banner?markDone=1");

  expect(await screen.findByText("Marked as done.")).toBeInTheDocument();
  expect(screen.getByTestId("url")).toHaveTextContent(/^\/banner\/my-banner$/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.bannergress.com/bnrs/my-banner/settings");
  expect(options.method).toBe("POST");
  expect(JSON.parse(options.body)).toEqual({ listType: "done" });
  expect(options.headers.get("Authorization")).toBe("Bearer fresh-token");
  expect(getBannerListType(loadBannergressSyncData(), "my-banner")).toBe("done");
  expect(window.sessionStorage.getItem(MARK_DONE_PENDING_STORAGE_KEY)).toBeNull();
});

test("signed out: asks to sign in, keeps the action across the sign-in and finishes it afterwards", async () => {
  const user = userEvent.setup();
  const fetchMock = mockSettingsApi();
  const authRequests = vi.fn();
  window.addEventListener(BANNERGRESS_AUTH_REQUEST_EVENT, authRequests);

  renderBannerPage("/banner/my-banner?markDone=1");

  expect(
    await screen.findByText("Sign in with Bannergress to mark this banner as done.")
  ).toBeInTheDocument();
  expect(screen.getByTestId("url")).toHaveTextContent(/^\/banner\/my-banner$/);
  expect(hasPendingMarkDone("my-banner")).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(authRequests).toHaveBeenCalledTimes(1);
  window.removeEventListener(BANNERGRESS_AUTH_REQUEST_EVENT, authRequests);

  // The sign-in popup stores the tokens.
  act(() => signIn());

  expect(await screen.findByText("Marked as done.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getBannerListType(loadBannergressSyncData(), "my-banner")).toBe("done");
  expect(hasPendingMarkDone("my-banner")).toBe(false);
});

test("expired sign-in (401): asks to sign in again", async () => {
  signIn();
  mockSettingsApi(401);

  renderBannerPage("/banner/my-banner?markDone=1");

  expect(
    await screen.findByText("Sign in with Bannergress to mark this banner as done.")
  ).toBeInTheDocument();
  expect(hasPendingMarkDone("my-banner")).toBe(true);
  expect(getBannerListType(loadBannergressSyncData(), "my-banner")).toBeNull();
});

test("resumes a pending mark-done after the page reloads without the parameter", async () => {
  savePendingMarkDone("my-banner");
  signIn();
  const fetchMock = mockSettingsApi();

  renderBannerPage("/banner/my-banner");

  expect(await screen.findByText("Marked as done.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("cancel drops the pending action", async () => {
  const user = userEvent.setup();
  mockSettingsApi();

  renderBannerPage("/banner/my-banner?markDone=1");

  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Sign in with Bannergress to mark this banner as done.")
    ).not.toBeInTheDocument()
  );
  expect(hasPendingMarkDone("my-banner")).toBe(false);
});

test("a server error offers a retry", async () => {
  const user = userEvent.setup();
  signIn();
  const fetchMock = mockSettingsApi(500);

  renderBannerPage("/banner/my-banner?markDone=1");

  expect(await screen.findByText("Couldn't mark this banner as done.")).toBeInTheDocument();
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Marked as done.")).toBeInTheDocument();
});

test("without the parameter nothing happens", async () => {
  signIn();
  const fetchMock = mockSettingsApi();

  renderBannerPage("/banner/my-banner?markDone=0");

  await waitFor(() =>
    expect(screen.getByTestId("url")).toHaveTextContent(/^\/banner\/my-banner$/)
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
