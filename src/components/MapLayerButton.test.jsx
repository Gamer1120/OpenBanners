import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAP_LAYER_STORAGE_KEY } from "../mapLayers";
import { MapLayerButton } from "./MapLayerButton";

describe("MapLayerButton", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("lists the layers with the current one checked and remembers a new choice", () => {
    render(<MapLayerButton className="icon-btn" />);
    const button = screen.getByRole("button", { name: "Map layers" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(button);
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Dark", "OpenStreetMap", "Streets", "Satellite"]);
    expect(screen.getByRole("menuitemradio", { name: "OpenStreetMap" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "false");
    expect(window.localStorage.getItem(MAP_LAYER_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Satellite" }));
    expect(window.localStorage.getItem(MAP_LAYER_STORAGE_KEY)).toBe("satellite");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByRole("menuitemradio", { name: "Satellite" })).toHaveAttribute("aria-checked", "true");
  });

  it("closes on Escape and on a press outside", () => {
    render(<MapLayerButton />);
    const button = screen.getByRole("button", { name: "Map layers" });
    fireEvent.click(button);
    expect(screen.getByRole("menuitemradio", { name: "OpenStreetMap" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
