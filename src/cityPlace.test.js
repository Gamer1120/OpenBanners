import { expect, test } from "vitest";
import { getPlaceMatchRank, rankPlacesForQuery } from "./cityPlace";

const place = (longName, formattedAddress, type = "locality", numberOfBanners = 1) => ({
  id: longName,
  shortName: longName,
  longName,
  formattedAddress,
  type,
  numberOfBanners,
});

// Shape of the real API answer for "Ens": ordered by banner count, matched on
// names we never display (other languages / sub-places).
const ENS = [
  place("Queensland", "Queensland, Australia", "administrative_area_level_1", 819),
  place("Moscow", "Moscow, Russia", "locality", 609),
  place("London", "London, UK", "locality", 516),
  place("Athens", "Athens, Greece", "locality", 104),
  place("Enschede", "Enschede, Netherlands", "locality", 94),
  place("Smolensk", "Smolensk, Smolensk Oblast, Russia", "locality", 52),
  place("Ensenada", "Ensenada, Baja California, Mexico", "locality", 3),
];

test("places whose shown name starts with the query come first", () => {
  const names = rankPlacesForQuery(ENS, "Ens", { homeCountry: "" }).map((p) => p.longName);

  expect(names.slice(0, 2)).toEqual(["Enschede", "Ensenada"]);
  expect(names).not.toContain("Moscow");
  expect(names).not.toContain("London");
  expect(names.indexOf("Queensland")).toBeGreaterThan(1);
});

test("the user's country wins within the same match quality", () => {
  const places = [
    place("Ensenada", "Ensenada, Baja California, Mexico", "locality", 300),
    place("Enschede", "Enschede, Netherlands", "locality", 94),
  ];

  expect(rankPlacesForQuery(places, "ens", { homeCountry: "netherlands" })[0].longName).toBe(
    "Enschede"
  );
});

test("match rank: prefix, word prefix, inside, none", () => {
  expect(getPlaceMatchRank(place("Amersfoort", "Amersfoort, Netherlands"), "amer")).toBe(0);
  expect(getPlaceMatchRank(place("Palm Beach Gardens", "Palm Beach Gardens, FL, USA"), "gard")).toBe(1);
  expect(getPlaceMatchRank(place("Samer", "62830 Samer, France"), "amer")).toBe(2);
  expect(getPlaceMatchRank(place("Moscow", "Moscow, Russia"), "ens")).toBeNull();
  expect(getPlaceMatchRank(place("Guayaramerín", "Guayaramerín, Bolivia"), "ramerin")).toBe(2);
});

test("falls back to the API matches when no shown name matches", () => {
  const names = rankPlacesForQuery([place("Moscow", "Moscow, Russia")], "Moskau", {
    homeCountry: "",
  }).map((p) => p.longName);

  expect(names).toEqual(["Moscow"]);
});
