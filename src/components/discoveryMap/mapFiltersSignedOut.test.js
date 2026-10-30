import { describe, expect, it } from "vitest";
import { countActiveMapFilters, DEFAULT_MAP_FILTERS, signedOutMapFilters } from "./mapFilters";

describe("signedOutMapFilters", () => {
  it("shows the default Hide Done as All when signed out, so a first visit has no filter badge", () => {
    const filters = signedOutMapFilters(DEFAULT_MAP_FILTERS, false);
    expect(filters.status).toBe("all");
    expect(countActiveMapFilters(filters)).toBe(0);
  });

  it("keeps Hide Done once signed in, and keeps other choices when signed out", () => {
    expect(signedOutMapFilters(DEFAULT_MAP_FILTERS, true).status).toBe("hideDone");
    expect(signedOutMapFilters({ ...DEFAULT_MAP_FILTERS, status: "todo" }, false).status).toBe("todo");
    expect(signedOutMapFilters({ ...DEFAULT_MAP_FILTERS, missions: "12+" }, false).missions).toBe("12+");
  });
});
