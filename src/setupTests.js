import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { clearHistoryEntryState } from "./scrollRestoration";

afterEach(() => {
  cleanup();
  // Every test starts on a fresh history: no remembered lists or scroll.
  clearHistoryEntryState();
});
