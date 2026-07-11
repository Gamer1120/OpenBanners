import { describe, expect, test } from "vitest";
import {
  BANNER_TOGETHER_GROUP_PRESET_IDS,
  BANNER_TOGETHER_GROUP_STATUSES,
  evaluateBannerTogetherGroupComparison,
  findBannerTogetherGroupPresetId,
  getBannerTogetherGroupPresetClauses,
  getBannerTogetherGroupPresetOptions,
  normalizeBannerTogetherGroupClauses,
  normalizeBannerTogetherGroupParticipants,
  normalizeBannerTogetherGroupStatus,
} from "./bannerTogetherGroupComparison";

const participants = [
  {
    id: "alice",
    label: "Alice",
    lists: {
      todo: [
        "all",
        "mine",
        "not-hidden",
        "bob-hidden",
        "cara-hidden",
        "pair-12",
      ],
      done: ["pair-23", "custom-a", "missing-catalog"],
      blacklist: ["custom-b"],
    },
  },
  {
    id: "bob",
    label: "Bob",
    lists: {
      todo: ["all", "pair-12", "pair-23"],
      done: ["not-hidden"],
      blacklist: ["bob-hidden", "custom-a"],
    },
  },
  {
    id: "cara",
    label: "Cara",
    lists: {
      todo: ["all", "pair-23"],
      done: ["pair-12", "custom-b"],
      blacklist: ["cara-hidden"],
    },
  },
];

const catalogBanners = [
  { id: "mine", title: "Bravo Mine only" },
  { id: "all", title: "Alpha Everyone" },
  { id: "not-hidden", title: "Charlie Not hidden" },
  { id: "bob-hidden", title: "Delta Bob hidden" },
  { id: "cara-hidden", title: "Echo Cara hidden" },
  { id: "pair-12", title: "Foxtrot Pair Alice Bob" },
  { id: "pair-23", title: "Golf Pair Bob Cara" },
  { id: "custom-a", title: "Hotel Custom A" },
  { id: "custom-b", title: "India Custom B" },
  { id: "unlisted", title: "Juliet Nobody listed" },
];

function evaluatePreset(presetId) {
  return evaluateBannerTogetherGroupComparison({
    catalogBanners,
    participants,
    localParticipantId: "alice",
    clauses: getBannerTogetherGroupPresetClauses(
      presetId,
      participants,
      "alice"
    ),
  });
}

describe("Banner Together group normalization", () => {
  test("normalizes hidden aliases and participant lists", () => {
    expect(BANNER_TOGETHER_GROUP_STATUSES).toEqual([
      "todo",
      "done",
      "hidden",
      "unlisted",
    ]);
    expect(normalizeBannerTogetherGroupStatus("blacklist")).toBe("hidden");
    expect(normalizeBannerTogetherGroupStatus("hide")).toBe("hidden");

    const normalized = normalizeBannerTogetherGroupParticipants(participants);
    expect(normalized[0].lists.hidden).toEqual(["custom-b"]);
    expect(normalized[1].lists.hidden).toEqual(["bob-hidden", "custom-a"]);
  });

  test("rejects duplicate and invalid participant or banner IDs", () => {
    expect(() =>
      normalizeBannerTogetherGroupParticipants([
        participants[0],
        { ...participants[1], id: "alice" },
      ])
    ).toThrow(/duplicate.*participant/i);
    expect(() =>
      normalizeBannerTogetherGroupParticipants([
        participants[0],
        { ...participants[1], id: " bad" },
      ])
    ).toThrow(/participant ID.*invalid/i);
    expect(() =>
      normalizeBannerTogetherGroupParticipants([
        participants[0],
        {
          ...participants[1],
          lists: { todo: ["duplicate", "duplicate"] },
        },
      ])
    ).toThrow(/appears more than once/i);
    expect(() =>
      normalizeBannerTogetherGroupParticipants(
        Array.from({ length: 9 }, (_value, index) => ({
          id: `participant-${index}`,
          label: `Participant ${index}`,
          lists: {},
        }))
      )
    ).toThrow(/2 to 8/i);
  });

  test("requires every participant exactly once in every clause", () => {
    expect(() =>
      normalizeBannerTogetherGroupClauses(participants, [
        {
          participantStatuses: {
            alice: ["todo"],
            bob: ["todo"],
          },
        },
      ])
    ).toThrow(/missing participant Cara/i);
    expect(() =>
      normalizeBannerTogetherGroupClauses(participants, [
        {
          participantStatuses: {
            alice: ["todo"],
            bob: [],
            cara: ["todo"],
          },
        },
      ])
    ).toThrow(/at least one status.*Bob/i);
    expect(() =>
      normalizeBannerTogetherGroupClauses(participants, [
        {
          participantStatuses: {
            alice: ["todo"],
            bob: ["todo"],
            cara: ["todo"],
            intruder: ["todo"],
          },
        },
      ])
    ).toThrow(/unknown.*intruder/i);
  });
});

describe("Banner Together group presets", () => {
  test("matches only banners everyone has on their to-do list", () => {
    expect(
      evaluatePreset(BANNER_TOGETHER_GROUP_PRESET_IDS.EVERYONE_TODO).results.map(
        (result) => result.id
      )
    ).toEqual(["all"]);
  });

  test("matches my to-do banners that everyone else has not listed", () => {
    expect(
      evaluatePreset(
        BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_OTHERS_UNLISTED
      ).results.map((result) => result.id)
    ).toEqual(["mine"]);
  });

  test("matches my to-do unless somebody else has hidden it", () => {
    expect(
      evaluatePreset(
        BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_NOBODY_ELSE_HIDDEN
      ).results.map((result) => result.id)
    ).toEqual(["all", "mine", "not-hidden", "pair-12"]);
  });

  test("generates pair alternatives for at least two to-do participants", () => {
    const clauses = getBannerTogetherGroupPresetClauses(
      BANNER_TOGETHER_GROUP_PRESET_IDS.AT_LEAST_TWO_TODO,
      participants,
      "alice"
    );

    expect(clauses).toHaveLength(3);
    expect(
      evaluatePreset(
        BANNER_TOGETHER_GROUP_PRESET_IDS.AT_LEAST_TWO_TODO
      ).results.map((result) => result.id)
    ).toEqual(["all", "pair-12", "pair-23"]);
  });

  test("returns preset options and recognizes normalized preset clauses", () => {
    const options = getBannerTogetherGroupPresetOptions(participants, "alice");
    const clauses = getBannerTogetherGroupPresetClauses(
      BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_NOBODY_ELSE_HIDDEN,
      participants,
      "alice"
    );

    expect(options.map((option) => option.label)).toEqual([
      "Everyone to-do",
      "My to-do, everyone else not listed",
      "My to-do, nobody else hidden",
      "At least two to-do",
    ]);
    expect(
      findBannerTogetherGroupPresetId({
        participants,
        localParticipantId: "alice",
        clauses,
      })
    ).toBe(
      BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_NOBODY_ELSE_HIDDEN
    );

    const pairClauses = getBannerTogetherGroupPresetClauses(
      BANNER_TOGETHER_GROUP_PRESET_IDS.AT_LEAST_TWO_TODO,
      participants,
      "alice"
    );
    expect(
      findBannerTogetherGroupPresetId({
        participants,
        localParticipantId: "alice",
        clauses: [...pairClauses].reverse(),
      })
    ).toBe(BANNER_TOGETHER_GROUP_PRESET_IDS.AT_LEAST_TWO_TODO);
  });
});

describe("evaluateBannerTogetherGroupComparison", () => {
  test("evaluates non-rectangular custom alternatives without cross-matching", () => {
    const comparison = evaluateBannerTogetherGroupComparison({
      catalogBanners,
      participants,
      localParticipantId: "alice",
      clauses: [
        {
          participantStatuses: {
            alice: ["done"],
            bob: ["hidden"],
            cara: ["unlisted"],
          },
        },
        {
          participantStatuses: {
            alice: ["hidden"],
            bob: ["unlisted"],
            cara: ["done"],
          },
        },
      ],
    });

    expect(comparison.results.map((result) => result.id)).toEqual([
      "custom-a",
      "custom-b",
    ]);
    expect(comparison.results[0].participantStatuses).toEqual({
      alice: "done",
      bob: "hidden",
      cara: "unlisted",
    });
    expect(comparison.missingCatalogCount).toBe(1);
    expect(comparison.missingMatchingCatalogCount).toBe(0);
  });

  test("distinguishes matching list IDs that are missing from the catalog", () => {
    const roomParticipants = participants.slice(0, 2);
    const comparison = evaluateBannerTogetherGroupComparison({
      catalogBanners: catalogBanners.filter((banner) => banner.id !== "all"),
      participants: roomParticipants,
      localParticipantId: "alice",
      clauses: getBannerTogetherGroupPresetClauses(
        BANNER_TOGETHER_GROUP_PRESET_IDS.EVERYONE_TODO,
        roomParticipants,
        "alice"
      ),
    });

    expect(comparison.results.map((result) => result.id)).toEqual(["pair-12"]);
    expect(comparison.missingMatchingCatalogCount).toBe(1);
  });

  test("uses the public catalog as the universe for not-listed combinations", () => {
    const clauses = [
      {
        participantStatuses: {
          alice: ["unlisted"],
          bob: ["unlisted"],
          cara: ["unlisted"],
        },
      },
    ];
    const comparison = evaluateBannerTogetherGroupComparison({
      catalogBanners,
      participants,
      localParticipantId: "alice",
      clauses,
    });

    expect(comparison.results.map((result) => result.id)).toEqual(["unlisted"]);
  });

  test("rejects a local viewer who is not a participant", () => {
    expect(() =>
      evaluateBannerTogetherGroupComparison({
        catalogBanners,
        participants,
        localParticipantId: "nobody",
        clauses: getBannerTogetherGroupPresetClauses(
          BANNER_TOGETHER_GROUP_PRESET_IDS.EVERYONE_TODO,
          participants,
          "alice"
        ),
      })
    ).toThrow(/local.*not in this room/i);
  });
});
