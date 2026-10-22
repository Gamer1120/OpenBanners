import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MapOverlay from "./MapOverlay";

const missions = [
  { id: "a", steps: { 0: { objective: "hack" } } },
  { id: "b", steps: { 0: { objective: "hack" }, 1: { objective: "enterPassphrase" } } },
];

describe("BannerGuider overlay", () => {
  it("warns before NEXT opens a passphrase mission", () => {
    render(<MapOverlay missions={missions} currentMission={1} setCurrentMission={() => {}} bannerId="x" />);
    expect(screen.getByRole("note")).toHaveTextContent("Mission 2 asks for a passphrase");
  });

  it("says nothing for other missions", () => {
    render(<MapOverlay missions={missions} currentMission={0} setCurrentMission={() => {}} bannerId="x" />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
