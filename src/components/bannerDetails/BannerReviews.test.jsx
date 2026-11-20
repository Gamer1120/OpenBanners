import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let state;
const save = vi.fn(async () => {});
const remove = vi.fn(async () => {});
let nextId = 7;
const suggest = vi.fn(async (name, kind) => ({ suggestion: { id: nextId++, name, kind, pending: true } }));
vi.mock("../../bannerReviews", async (importOriginal) => ({
  ...(await importOriginal()),
  useBannerReviews: () => ({ ...state, save, remove, suggest }),
}));

import BannerReviews from "./BannerReviews";
import { REVIEW_TAGS } from "../../reviewTags.mjs";

const summary = (extra = {}) => ({
  bannerId: "b1",
  count: 3,
  average: 3.7,
  stars: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 },
  tags: [
    { id: "scenic-route", kind: "positive", count: 3 },
    { id: "no-shade", kind: "negative", count: 2 },
  ],
  ...extra,
});

describe("BannerReviews", () => {
  beforeEach(() => {
    save.mockClear();
    remove.mockClear();
    suggest.mockClear();
    nextId = 7;
  });

  it("shows the average, the number of reviews and the most picked tags, and asks signed-out visitors to sign in", () => {
    state = { status: "ready", data: summary(), loggedIn: false };
    render(<BannerReviews bannerId="b1" />);
    const section = screen.getByRole("region", { name: "Reviews" });
    expect(within(section).getByRole("img", { name: "3.7 out of 5 stars" })).toBeTruthy();
    expect(section.textContent).toContain("3 reviews");
    const tags = within(section).getByRole("list", { name: "Most picked tags" });
    expect(tags.textContent).toContain("Scenic route3");
    expect(tags.textContent).toContain("No shade2");
    expect(within(tags).getAllByRole("listitem")[0].className).toContain("ok");
    expect(within(tags).getAllByRole("listitem")[1].className).toContain("bad");
    expect(within(section).getByText("Sign in to review this banner.")).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Rate this banner" })).toBeNull();
    expect(within(section).queryByRole("button", { name: "Suggest a tag" })).toBeNull();
  });

  it("says when there are no reviews yet", () => {
    state = { status: "ready", data: summary({ count: 0, average: null, tags: [] }), loggedIn: false };
    render(<BannerReviews bannerId="b1" />);
    expect(screen.getByText("No reviews yet.")).toBeTruthy();
  });

  it("lets a signed-in visitor rate with stars and tags only, no text", async () => {
    const user = userEvent.setup();
    state = { status: "ready", data: summary({ mine: null }), loggedIn: true };
    render(<BannerReviews bannerId="b1" />);
    await user.click(screen.getByRole("button", { name: "Rate this banner" }));
    // Stars and tag toggles, but nowhere to type.
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    // Every tag of the group, then "Suggest a tag" as the last chip.
    for (const [name, kind] of [["What was good", "positive"], ["What could be better", "negative"]]) {
      const buttons = [...screen.getByRole("group", { name }).querySelectorAll("button")];
      expect(buttons).toHaveLength(REVIEW_TAGS.filter((tag) => tag.kind === kind).length + 1);
      expect(buttons.at(-1).textContent).toBe("Suggest a tag");
      expect(buttons.at(-1).className).toContain("chip");
    }
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton.disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: "4 stars" }));
    await user.click(screen.getByRole("button", { name: "Scenic route" }));
    await user.click(screen.getByRole("button", { name: "Busy traffic" }));
    await user.click(screen.getByRole("button", { name: "Busy traffic" }));
    expect(screen.getByRole("button", { name: "Scenic route" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(4, ["scenic-route"], []);
  });

  it("shows your own review with Edit and Delete", async () => {
    const user = userEvent.setup();
    state = { status: "ready", data: summary({ mine: { stars: 5, tags: ["nice-landmarks"] } }), loggedIn: true };
    render(<BannerReviews bannerId="b1" />);
    expect(screen.getByText("Your review")).toBeTruthy();
    expect(screen.getByRole("img", { name: "5 stars" })).toBeTruthy();
    expect(screen.getByText("Nice landmarks")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("radio", { name: "5 stars" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Nice landmarks" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalled();
  });

  it("the suggest chip in each group opens a field there, sends with that group's kind and adds a pending chip", async () => {
    const user = userEvent.setup();
    state = { status: "ready", data: summary({ mine: null, minePending: [] }), loggedIn: true };
    render(<BannerReviews bannerId="b1" />);
    expect(screen.queryByRole("button", { name: "Suggest a tag" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Rate this banner" }));
    const bad = screen.getByRole("group", { name: "What could be better" });
    const good = screen.getByRole("group", { name: "What was good" });
    // No Positive/Negative choice any more: the group decides.
    await user.click(within(bad).getByRole("button", { name: "Suggest a tag" }));
    expect(screen.queryAllByRole("radio", { name: /positive|negative/i })).toEqual([]);
    const input = within(bad).getByRole("textbox", { name: "Tag name" });
    expect(input.getAttribute("maxlength")).toBe("40");
    expect(document.activeElement).toBe(input);
    expect(within(bad).getByText(/doesn't show to others until they add it/)).toBeTruthy();
    expect(within(good).queryByRole("textbox")).toBeNull();
    await user.type(input, "Muddy paths{Enter}");
    expect(suggest).toHaveBeenCalledWith("Muddy paths", "negative");
    expect(await within(bad).findByText("Thanks! Your tag suggestion was sent.")).toBeTruthy();
    // It's now your chip in that group, picked, marked as waiting.
    const chip = within(bad).getByRole("button", { name: "Muddy paths (Suggested, waiting for approval)" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(within(bad).getByText("Suggested, waiting for approval")).toBeTruthy();
    await user.click(within(good).getByRole("button", { name: "Suggest a tag" }));
    await user.type(within(good).getByRole("textbox", { name: "Tag name" }), "Lots of benches");
    await user.click(within(good).getByRole("button", { name: "Send" }));
    expect(suggest).toHaveBeenLastCalledWith("Lots of benches", "positive");
    // Removing it like any tag: left out when saving.
    await user.click(screen.getByRole("radio", { name: "3 stars" }));
    await user.click(chip);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(3, [], [8]);
  });

  it("Cancel and Escape close the field and bring the chip back, without sending", async () => {
    const user = userEvent.setup();
    state = { status: "ready", data: summary({ mine: { stars: 4, tags: [], pending: [] }, minePending: [] }), loggedIn: true };
    render(<BannerReviews bannerId="b1" />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const good = screen.getByRole("group", { name: "What was good" });
    await user.click(within(good).getByRole("button", { name: "Suggest a tag" }));
    await user.type(within(good).getByRole("textbox", { name: "Tag name" }), "Half typed");
    await user.click(within(good).getByRole("button", { name: "Cancel" }));
    expect(within(good).queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(within(good).getByRole("button", { name: "Suggest a tag" }));
    await user.click(within(good).getByRole("button", { name: "Suggest a tag" }));
    expect(within(good).getByRole("textbox", { name: "Tag name" }).value).toBe("");
    await user.keyboard("Nope{Escape}");
    expect(within(good).queryByRole("textbox")).toBeNull();
    expect(within(good).getByRole("button", { name: "Suggest a tag" })).toBeTruthy();
    // The editor itself is still open.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("shows your pending suggested tag in your own review and in the form, picked", async () => {
    const user = userEvent.setup();
    const pending = [{ suggestionId: 5, name: "Muddy paths", kind: "negative" }];
    state = { status: "ready", data: summary({ mine: { stars: 4, tags: ["scenic-route"], pending }, minePending: pending }), loggedIn: true };
    render(<BannerReviews bannerId="b1" />);
    const item = screen.getByRole("listitem", { name: "Muddy paths (Suggested, waiting for approval)" });
    expect(item.className).toContain("bad");
    expect(screen.getByText("Suggested, waiting for approval")).toBeTruthy();
    // Not among the public "Most picked tags".
    expect(screen.getByRole("list", { name: "Most picked tags" }).textContent).not.toContain("Muddy");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const bad = screen.getByRole("group", { name: "What could be better" });
    const chip = within(bad).getByRole("button", { name: "Muddy paths (Suggested, waiting for approval)" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const buttons = bad.querySelectorAll("button");
    expect(buttons[buttons.length - 1].textContent).toBe("Suggest a tag");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(4, ["scenic-route"], [5]);
  });
});
