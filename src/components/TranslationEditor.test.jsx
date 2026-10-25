import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let auth = null;
vi.mock("../bannergressSync", () => ({
  BANNERGRESS_AUTH_REQUEST_EVENT: "test-auth-request",
  useBannergressAuth: () => auth,
}));
const suggestTranslation = vi.fn();
const getMyTranslationSuggestions = vi.fn(async () => ({ suggestions: [] }));
vi.mock("../translationApi", async (importActual) => ({
  ...(await importActual()),
  suggestTranslation: (...args) => suggestTranslation(...args),
  getMyTranslationSuggestions: (...args) => getMyTranslationSuggestions(...args),
}));

import TranslationEditor from "./TranslationEditor";
import { mergeOverrides } from "../i18n";

let overrides = {};
beforeEach(() => {
  auth = null;
  overrides = {};
  suggestTranslation.mockReset();
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ overrides }) }))
  );
});
afterEach(() => vi.unstubAllGlobals());

const rowOf = (text) => screen.getAllByText(text, { selector: ".te-en .te-text" })[0].closest("li");

const ready = () => waitFor(() => expect(document.querySelector(".te-list")).not.toBeNull());

async function search(user, text) {
  await user.type(screen.getByRole("searchbox", { name: "Search texts" }), text);
}

describe("translation editor", () => {
  it("shows the English next to the current translation and asks to log in before suggesting", async () => {
    const user = userEvent.setup();
    const requested = vi.fn();
    window.addEventListener("test-auth-request", requested);
    render(<TranslationEditor />);
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("nl");
    expect(screen.queryByRole("option", { name: "English" })).toBeNull();
    await ready();
    await search(user, "Log in with Bannergress to start");
    expect(screen.getByText("Log in met Bannergress om een plan te starten.", { selector: ".te-text" })).toBeInTheDocument();
    const row = rowOf("Log in with Bannergress to start a plan.");
    await user.click(within(row).getByRole("button", { name: "Suggest a translation" }));
    expect(within(row).getByText("Log in with Bannergress to suggest a translation.")).toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Log in" }));
    expect(requested).toHaveBeenCalled();
    window.removeEventListener("test-auth-request", requested);
  });

  it("checks the placeholders, then sends the suggestion", async () => {
    const user = userEvent.setup();
    auth = { accessToken: "token" };
    suggestTranslation.mockResolvedValue({ suggestion: { id: 7, key: "#{number} of {banner}", form: null, text: "Nr. {number} van {banner}", status: "pending" } });
    render(<TranslationEditor />);
    await ready();
    await search(user, "#{{number} of");
    const row = rowOf("#{number} of {banner}");
    await user.click(within(row).getByRole("button", { name: "Suggest a translation" }));
    const box = within(row).getByRole("textbox", { name: "Your translation" });
    expect(box).toHaveValue("#{number} van {banner}");
    await user.clear(box);
    await user.type(box, "Nr. {{number} van de banner");
    await user.click(within(row).getByRole("button", { name: "Suggest" }));
    expect(within(row).getByRole("alert")).toHaveTextContent("{banner} {number}");
    expect(suggestTranslation).not.toHaveBeenCalled();
    await user.clear(box);
    await user.type(box, "Nr. {{number} van {{banner}");
    await user.click(within(row).getByRole("button", { name: "Suggest" }));
    expect(suggestTranslation).toHaveBeenCalledWith("nl", { key: "#{number} of {banner}", form: "", text: "Nr. {number} van {banner}" });
    await within(row).findByText("Thanks! A moderator will check your suggestion.");
    expect(within(row).getByText("Your suggestion is waiting for review: Nr. {number} van {banner}")).toBeInTheDocument();
  });

  it("shows each plural form of the language separately", async () => {
    const user = userEvent.setup();
    render(<TranslationEditor />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "ru");
    await waitFor(() => expect(document.querySelector(".te-list")?.getAttribute("lang")).toBe("ru"));
    await search(user, "{{count} missions are");
    const row = rowOf("{count} missions are waiting for Niantic");
    const labels = within(row).getAllByText(/^(one|few|many|other) · e\.g\./).map((node) => node.textContent);
    expect(labels.map((label) => label.split(" ")[0]).sort()).toEqual(["few", "many", "one", "other"]);
    expect(within(row).getAllByRole("button", { name: "Suggest a translation" })).toHaveLength(4);
  });

  it("shows approved overrides as the current translation", async () => {
    const user = userEvent.setup();
    overrides = { Settings: "Voorkeuren" };
    render(<TranslationEditor />);
    await ready();
    await search(user, "Settings");
    await screen.findByText("Voorkeuren", { selector: ".te-text" });
    expect(within(rowOf("Settings")).getByText(/updated/)).toBeInTheDocument();
  });
});

describe("approved overrides", () => {
  it("merge over the bundled locale, plural forms one by one", () => {
    const bundled = { "Log in": "Inloggen", "{count} missions": { one: "{count} missie", other: "{count} missies" } };
    expect(mergeOverrides(bundled, { "Log in": "Aanmelden", "{count} missions": { other: "{count} opdrachten" } })).toEqual({
      "Log in": "Aanmelden",
      "{count} missions": { one: "{count} missie", other: "{count} opdrachten" },
    });
    expect(bundled["Log in"]).toBe("Inloggen");
  });
});
