import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let state;
const save = vi.fn(async () => {});
const remove = vi.fn(async () => {});
const suggest = vi.fn(async () => ({ suggestion: { id: 1 } }));
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
    expect(screen.getByRole("group", { name: "What was good" }).querySelectorAll("button")).toHaveLength(
      REVIEW_TAGS.filter((tag) => tag.kind === "positive").length
    );
    expect(screen.getByRole("group", { name: "What could be better" }).querySelectorAll("button")).toHaveLength(
      REVIEW_TAGS.filter((tag) => tag.kind === "negative").length
    );
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton.disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: "4 stars" }));
    await user.click(screen.getByRole("button", { name: "Scenic route" }));
    await user.click(screen.getByRole("button", { name: "Busy traffic" }));
    await user.click(screen.getByRole("button", { name: "Busy traffic" }));
    expect(screen.getByRole("button", { name: "Scenic route" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(4, ["scenic-route"]);
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

  it("suggests a tag (name + positive/negative), which only goes to the team", async () => {
    const user = userEvent.setup();
    state = { status: "ready", data: summary({ mine: null }), loggedIn: true };
    render(<BannerReviews bannerId="b1" />);
    await user.click(screen.getByRole("button", { name: "Suggest a tag" }));
    const input = screen.getByRole("textbox", { name: "Tag name" });
    expect(input.getAttribute("maxlength")).toBe("40");
    await user.type(input, "Muddy paths");
    await user.click(screen.getByRole("radio", { name: "Negative" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(suggest).toHaveBeenCalledWith("Muddy paths", "negative");
    expect(await screen.findByText("Thanks! Your tag suggestion was sent.")).toBeTruthy();
  });
});
