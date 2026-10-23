import { beforeEach, expect, test } from "vitest";
import {
  getBrowseStateScope,
  readBrowseState,
  saveBrowseState,
} from "./browseState";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("search results get their own scope that starts on Best match", () => {
  const scope = getBrowseStateScope({ query: "enschede" });

  expect(scope).toBe("search:enschede");
  expect(readBrowseState(scope).sortOption).toBe("Relevance");
  expect(readBrowseState(getBrowseStateScope({ placeId: "x" })).sortOption).toBe("Created");
});

test("a search doesn't overwrite the remembered Browse place", () => {
  const placeScope = getBrowseStateScope({ placeId: "enschede-1" });
  const searchScope = getBrowseStateScope({ query: "enschede" });

  saveBrowseState(placeScope, { sortOption: "Distance", banners: [{ id: "a" }] });
  saveBrowseState(searchScope, { sortOption: "Created", banners: [{ id: "b" }] });

  expect(readBrowseState(placeScope).sortOption).toBe("Distance");
  expect(readBrowseState(placeScope).banners).toEqual([{ id: "a" }]);
  expect(readBrowseState(searchScope).sortOption).toBe("Created");
  expect(readBrowseState(getBrowseStateScope({ query: "other" })).banners).toEqual([]);
});

test("Best match is only kept for search results", () => {
  const placeScope = getBrowseStateScope({ placeId: "enschede-1" });

  saveBrowseState(placeScope, { sortOption: "Relevance" });

  expect(readBrowseState(placeScope).sortOption).toBe("Created");
});

test("Show offline banners survives Back in this tab, but not a new visit", () => {
  const scope = getBrowseStateScope({ placeId: "nl" });
  saveBrowseState(scope, { filters: { showOfflineBanners: true, minimumMissions: 12 } });
  expect(readBrowseState(scope).filters).toMatchObject({ showOfflineBanners: true, minimumMissions: 12 });
  expect(JSON.parse(window.localStorage.getItem("openbanners.browse.state")).filters.showOfflineBanners).toBe(false);

  window.sessionStorage.clear();
  expect(readBrowseState(scope).filters).toMatchObject({ showOfflineBanners: false, minimumMissions: 12 });
});
