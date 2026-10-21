import { expect, test } from "vitest";
import { getFinish, isOnStartMarker } from "./BannerDetailsPage";

const step = (title, latitude, longitude, type = "portal") => ({
  poi: { title, latitude, longitude, type },
});

test("finish is the last usable waypoint of the last mission", () => {
  const missions = [
    { steps: { 0: step("A", 52, 6), 1: step("B", 52.001, 6) } },
    {
      steps: {
        0: step("C", 52.002, 6),
        1: step("Last portal", 52.003, 6),
        2: step("Gone", 52.004, 6, "unavailable"),
      },
    },
  ];

  expect(getFinish(missions)).toEqual({
    position: [52.003, 6],
    title: "Last portal",
    missionIndex: 1,
    stepIndex: 1,
  });
  expect(getFinish([])).toBeNull();
});

test("finish on a mission's start portal is detected (marker gets shifted)", () => {
  const missionPositions = [
    [[52, 6], [52.001, 6]],
    [[52.003, 6], [52.004, 6]],
  ];

  expect(isOnStartMarker([52.00001, 6.00001], missionPositions)).toBe(true);
  expect(isOnStartMarker([52.004, 6], missionPositions)).toBe(false);
});
