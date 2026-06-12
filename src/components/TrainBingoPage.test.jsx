import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import {
  TRAIN_BINGO_STORAGE_KEY,
  createInitialTrainBingoSquares,
} from "../trainBingo";
import TrainBingoPage from "./TrainBingoPage";

const createBoardState = (overrides = {}) => ({
  version: 1,
  updatedAt: "2026-06-12T10:00:00Z",
  squares: createInitialTrainBingoSquares(),
  ...overrides,
});

const createJsonResponse = (body, options = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: vi.fn().mockResolvedValue(body),
});

beforeEach(() => {
  window.localStorage.clear();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

test("keeps the bingo board hidden until a valid password is entered", async () => {
  globalThis.fetch.mockResolvedValueOnce(createJsonResponse(createBoardState()));

  render(<TrainBingoPage />);

  expect(await screen.findByLabelText("Wachtwoord")).toBeInTheDocument();
  expect(screen.queryByLabelText("Treinbingo bord")).not.toBeInTheDocument();
});

test("saves a green square through the server API", async () => {
  const user = userEvent.setup();
  const updatedSquares = createInitialTrainBingoSquares();
  updatedSquares[0] = "green";

  globalThis.fetch
    .mockResolvedValueOnce(createJsonResponse(createBoardState()))
    .mockResolvedValueOnce(createJsonResponse(createBoardState()))
    .mockResolvedValueOnce(
      createJsonResponse(
        createBoardState({
          version: 2,
          squares: updatedSquares,
        })
      )
    );

  render(<TrainBingoPage />);

  await user.type(await screen.findByLabelText("Wachtwoord"), "1");
  await user.click(screen.getByRole("button", { name: "Inloggen" }));
  expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: "Vertrekbord toont 10+ min vertraging",
    })
  );

  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));

  const postCall = globalThis.fetch.mock.calls.find(
    ([, options]) => options?.method === "POST"
  );

  expect(JSON.parse(postCall[1].body)).toEqual({
    action: "toggle",
    index: 0,
    password: "1",
    version: 1,
  });
  expect(window.localStorage.getItem(TRAIN_BINGO_STORAGE_KEY)).toBe("green");
  expect(
    screen.getByRole("button", {
      name: "Vertrekbord toont 10+ min vertraging",
    })
  ).toHaveClass("train-bingo-square-green");
});

test("refreshes the visible board from the server while logged in", async () => {
  window.localStorage.setItem(TRAIN_BINGO_STORAGE_KEY, "green");
  const updatedSquares = createInitialTrainBingoSquares();
  updatedSquares[1] = "red";

  globalThis.fetch
    .mockResolvedValueOnce(createJsonResponse(createBoardState()))
    .mockResolvedValueOnce(
      createJsonResponse(
        createBoardState({
          version: 2,
          squares: updatedSquares,
        })
      )
    );

  render(<TrainBingoPage />);

  expect(await screen.findByLabelText("Treinbingo bord")).toBeInTheDocument();

  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2), {
    timeout: 3500,
  });
  expect(
    screen.getByRole("button", {
      name: "Perronnummer verandert binnen 15 min voor vertrek",
    })
  ).toHaveClass("train-bingo-square-red");
}, 8000);
