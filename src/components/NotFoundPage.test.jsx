import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./Home";
import ErrorBoundary from "./ErrorBoundary";

describe("unknown URLs", () => {
  beforeEach(() => {
    window.localStorage.clear();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => null }));
  });

  it("show Page not found with the menu and links home", async () => {
    render(
      <MemoryRouter initialEntries={["/no/such/page"]}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<Home notFound />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More options" })).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Go to home page" })).toHaveAttribute("href", "/");
    expect(main.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/map");
    expect(document.title).toMatch(/Page not found/);
  });
});

function Boom({ explode }) {
  if (explode) {
    throw new Error("render failed");
  }
  return <p>Fine again</p>;
}

describe("ErrorBoundary", () => {
  let consoleError;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("shows a friendly message with Reload instead of a white page", () => {
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to home page" })).toHaveAttribute("href", "/");
  });

  it("recovers when the page changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom explode />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom explode={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Fine again")).toBeInTheDocument();
  });
});
