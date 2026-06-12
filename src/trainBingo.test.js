import {
  createInitialTrainBingoSquares,
  detectTrainBingo,
  toggleTrainBingoSquare,
} from "./trainBingo";

test("treats the center free square as both colors for bingo", () => {
  const squares = createInitialTrainBingoSquares();
  squares[10] = "green";
  squares[11] = "green";
  squares[13] = "green";
  squares[14] = "green";

  expect(detectTrainBingo(squares, "green")).toBe(true);
  expect(detectTrainBingo(squares, "red")).toBe(false);
});

test("does not let one player toggle the other player's square", () => {
  const squares = createInitialTrainBingoSquares();
  squares[0] = "red";

  expect(toggleTrainBingoSquare(squares, 0, "green")[0]).toBe("red");
});

test("toggles a player's own square back to empty", () => {
  const squares = createInitialTrainBingoSquares();
  squares[0] = "green";

  expect(toggleTrainBingoSquare(squares, 0, "green")[0]).toBe("empty");
});
