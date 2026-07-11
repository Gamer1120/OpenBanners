import { describe, expect, test } from "vitest";
import {
  BANNER_TOGETHER_COMPARISON_PRESET_IDS,
  BANNER_TOGETHER_COMPARISON_STATUSES,
  BANNER_TOGETHER_DEFAULT_COMPARISON_PRESET_ID,
  bannerTogetherComparisonMaskMatches,
  canonicalizeBannerTogetherComparisonClauses,
  createBannerTogetherComparisonMask,
  createBannerTogetherMembershipIndex,
  createBannerTogetherMembershipIndexFromLists,
  evaluateBannerTogetherComparison,
  findBannerTogetherComparisonPresetId,
  getBannerTogetherComparisonPresetClauses,
  getBannerTogetherComparisonPresetOptions,
  getBannerTogetherComparisonRoleLabels,
  getBannerTogetherMembershipStatus,
  normalizeBannerTogetherComparisonStatus,
} from "./bannerTogetherComparison";

const catalogBanners = [
  { id: "uu", title: "Zulu Untouched" },
  { id: "th", title: "Charlie Hidden" },
  { id: "tt", title: "Alpha Shared" },
  { id: "dt", title: "Echo Recipient Todo" },
  { id: "tu", title: "Delta Creator Only" },
  { id: "td", title: "Bravo Recipient Done" },
];

const creatorMemberships = createBannerTogetherMembershipIndexFromLists({
  todo: ["tt", "td", "th", "tu"],
  done: ["dt"],
});
const recipientMemberships = createBannerTogetherMembershipIndexFromLists({
  todo: ["tt", "dt"],
  done: ["td"],
  blacklist: ["th"],
});

function evaluatePreset(presetId) {
  return evaluateBannerTogetherComparison({
    catalogBanners,
    creatorMemberships,
    recipientMemberships,
    clauses: getBannerTogetherComparisonPresetClauses(presetId),
  });
}

describe("Banner Together comparison statuses and memberships", () => {
  test("uses four exclusive comparison statuses and normalizes hidden aliases", () => {
    expect(BANNER_TOGETHER_COMPARISON_STATUSES).toEqual([
      "todo",
      "done",
      "hidden",
      "unlisted",
    ]);
    expect(normalizeBannerTogetherComparisonStatus("blacklist")).toBe("hidden");
    expect(normalizeBannerTogetherComparisonStatus("hide")).toBe("hidden");
    expect(() => normalizeBannerTogetherComparisonStatus("none")).toThrow(
      /unsupported/i
    );
  });

  test("builds membership indexes from API entries, objects, and grouped lists", () => {
    const apiIndex = createBannerTogetherMembershipIndex([
      { id: "todo-banner", listType: "todo" },
      { id: "hidden-banner", listType: "blacklist" },
      { id: "hidden-banner", status: "hidden" },
    ]);
    const objectIndex = createBannerTogetherMembershipIndex({
      "done-banner": "done",
    });

    expect(getBannerTogetherMembershipStatus(apiIndex, "todo-banner")).toBe(
      "todo"
    );
    expect(getBannerTogetherMembershipStatus(apiIndex, "hidden-banner")).toBe(
      "hidden"
    );
    expect(getBannerTogetherMembershipStatus(apiIndex, "missing-banner")).toBe(
      "unlisted"
    );
    expect(getBannerTogetherMembershipStatus(objectIndex, "done-banner")).toBe(
      "done"
    );
  });

  test("rejects conflicting source lists and explicit unlisted membership", () => {
    expect(() =>
      createBannerTogetherMembershipIndexFromLists({
        todo: ["changing-banner"],
        done: ["changing-banner"],
      })
    ).toThrow(/more than one/i);
    expect(() =>
      createBannerTogetherMembershipIndex({ "not-stored": "unlisted" })
    ).toThrow(/derived/i);
  });
});

describe("Banner Together comparison clauses", () => {
  test("canonicalizes OR clauses and removes duplicate status pairs", () => {
    const clauses = [
      {
        creator: ["done", "todo", "todo"],
        recipient: ["todo", "blacklist"],
      },
      { creator: ["todo"], recipient: ["hidden"] },
    ];

    expect(canonicalizeBannerTogetherComparisonClauses(clauses)).toEqual([
      { creator: ["todo"], recipient: ["todo", "hidden"] },
      { creator: ["done"], recipient: ["todo", "hidden"] },
    ]);
  });

  test("represents arbitrary status combinations in a canonical mask", () => {
    const mask = createBannerTogetherComparisonMask([
      { creator: ["todo"], recipient: ["done", "unlisted"] },
      { creator: ["done"], recipient: ["todo"] },
    ]);

    expect(bannerTogetherComparisonMaskMatches(mask, "todo", "done")).toBe(
      true
    );
    expect(
      bannerTogetherComparisonMaskMatches(mask, "todo", "unlisted")
    ).toBe(true);
    expect(bannerTogetherComparisonMaskMatches(mask, "done", "todo")).toBe(
      true
    );
    expect(bannerTogetherComparisonMaskMatches(mask, "todo", "hidden")).toBe(
      false
    );
  });

  test("rejects empty, incomplete, and unexpected clauses", () => {
    expect(() => createBannerTogetherComparisonMask([])).toThrow(/at least one/i);
    expect(() =>
      createBannerTogetherComparisonMask([
        { creator: [], recipient: ["todo"] },
      ])
    ).toThrow(/creator status/i);
    expect(() =>
      createBannerTogetherComparisonMask([
        { creator: ["todo"], recipient: ["todo"], extra: true },
      ])
    ).toThrow(/require creator and recipient/i);
  });
});

describe("Banner Together comparison presets", () => {
  test("defaults to banners on both participants' to-do lists", () => {
    expect(BANNER_TOGETHER_DEFAULT_COMPARISON_PRESET_ID).toBe(
      BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO
    );
    expect(
      findBannerTogetherComparisonPresetId([
        { creator: ["todo"], recipient: ["todo"] },
      ])
    ).toBe(BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO);
  });

  test("uses role-aware labels without reversing serialized semantics", () => {
    expect(getBannerTogetherComparisonRoleLabels("creator")).toEqual({
      creator: "Mine",
      recipient: "Theirs",
    });
    expect(getBannerTogetherComparisonRoleLabels("recipient")).toEqual({
      creator: "Inviter",
      recipient: "Mine",
    });

    const creatorOptions = getBannerTogetherComparisonPresetOptions("creator");
    const recipientOptions = getBannerTogetherComparisonPresetOptions("recipient");
    const presetId =
      BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_ONLY;

    expect(creatorOptions.find((option) => option.id === presetId).label).toBe(
      "My to-do only"
    );
    expect(recipientOptions.find((option) => option.id === presetId).label).toBe(
      "Inviter's to-do only"
    );
    expect(recipientOptions.find((option) => option.id === presetId).clauses).toEqual(
      creatorOptions.find((option) => option.id === presetId).clauses
    );
  });
});

describe("evaluateBannerTogetherComparison", () => {
  test("returns only the shared to-do intersection by default", () => {
    const comparison = evaluatePreset(
      BANNER_TOGETHER_COMPARISON_PRESET_IDS.BOTH_TODO
    );

    expect(comparison.results).toEqual([
      {
        id: "tt",
        banner: { id: "tt", title: "Alpha Shared" },
        creatorStatus: "todo",
        recipientStatus: "todo",
      },
    ]);
  });

  test("returns creator to-do banners absent from every recipient list", () => {
    const comparison = evaluatePreset(
      BANNER_TOGETHER_COMPARISON_PRESET_IDS.CREATOR_TODO_ONLY
    );

    expect(comparison.results.map((result) => result.id)).toEqual(["tu"]);
    expect(comparison.results[0]).toMatchObject({
      creatorStatus: "todo",
      recipientStatus: "unlisted",
    });
  });

  test("excludes only recipient-hidden banners for the not-hidden preset", () => {
    const comparison = evaluatePreset(
      BANNER_TOGETHER_COMPARISON_PRESET_IDS
        .CREATOR_TODO_NOT_RECIPIENT_HIDDEN
    );

    expect(comparison.results.map((result) => result.id)).toEqual([
      "tt",
      "td",
      "tu",
    ]);
    expect(comparison.results.map((result) => result.id)).not.toContain("th");
  });

  test("evaluates alternative clauses as a deduplicated union", () => {
    const comparison = evaluateBannerTogetherComparison({
      catalogBanners,
      creatorMemberships,
      recipientMemberships,
      clauses: [
        { creator: ["todo"], recipient: ["hidden"] },
        { creator: ["done"], recipient: ["todo"] },
        { creator: ["todo"], recipient: ["blacklist"] },
      ],
    });

    expect(comparison.results.map((result) => result.id)).toEqual(["th", "dt"]);
  });

  test("uses the public catalog as the universe for both-unlisted results", () => {
    const comparison = evaluateBannerTogetherComparison({
      catalogBanners,
      creatorMemberships,
      recipientMemberships,
      clauses: [
        { creator: ["unlisted"], recipient: ["unlisted"] },
      ],
    });

    expect(comparison.results.map((result) => result.id)).toEqual(["uu"]);
  });

  test("merges duplicate catalog metadata and sorts results stably by title", () => {
    const comparison = evaluateBannerTogetherComparison({
      catalogBanners: [
        { id: "second", title: "Same", formattedAddress: "Old address" },
        { id: "first", title: "same", picture: "/first.jpg" },
        {
          id: "second",
          title: undefined,
          formattedAddress: "Current address",
          picture: "/second.jpg",
        },
      ],
      clauses: [
        {
          creator: ["unlisted"],
          recipient: ["unlisted"],
        },
      ],
    });

    expect(comparison.results.map((result) => result.id)).toEqual([
      "first",
      "second",
    ]);
    expect(comparison.results[1].banner).toEqual({
      id: "second",
      title: "Same",
      formattedAddress: "Current address",
      picture: "/second.jpg",
    });
  });

  test("counts unique snapshot IDs missing from the public catalog", () => {
    const comparison = evaluateBannerTogetherComparison({
      catalogBanners: [{ id: "available", title: "Available" }],
      creatorMemberships: {
        available: "todo",
        deleted: "todo",
      },
      recipientMemberships: {
        deleted: "done",
        moved: "hidden",
      },
      clauses: [
        {
          creator: ["todo"],
          recipient: ["unlisted", "done"],
        },
      ],
    });

    expect(comparison.results.map((result) => result.id)).toEqual(["available"]);
    expect(comparison.missingCatalogCount).toBe(2);
  });
});
