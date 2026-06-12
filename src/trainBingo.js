export const TRAIN_BINGO_STORAGE_KEY = "train-bingo-active-player";

export const TRAIN_BINGO_FREE_INDEX = 12;

export const TRAIN_BINGO_TEXTS = [
  "Vertrekbord toont 10+ min vertraging",
  "Perronnummer verandert binnen 15 min voor vertrek",
  "Iemand zit op onze gereserveerde stoel",
  "Bagagerek in onze coupé is volledig vol",
  "Grenscontrole loopt door de trein",
  "Trein vertrekt later dan gepland",
  "Trein komt aan op ander spoor dan aangekondigd",
  "Iemand telefoneert hoorbaar in stiltecoupé",
  "Koffer van andere reiziger blokkeert gangpad",
  "Omroep in andere taal zonder Engelse/Nederlandse herhaling",
  "Wagonnummer ontbreekt aan buitenkant trein",
  "Gereserveerde wagon ontbreekt in de trein",
  "VRIJ VAKJE: “Typisch treinreizen”",
  "Fiets, buggy of koffer blokkeert deurgebied",
  "Conducteur controleert ticket én ID",
  "Toilet heeft bordje “buiten gebruik”",
  "Display in trein toont verkeerde bestemming",
  "Reiziger speelt geluid hardop af zonder koptelefoon",
  "Iemand probeert in te stappen terwijl mensen uitstappen",
  "Trein staat 5+ minuten stil buiten een station",
  "Restaurant/bistro is dicht of onbemand",
  "Stopcontact bij onze zitplek levert geen stroom",
  "Iemand eet iets duidelijk geurigs in onze buurt",
  "Omroepbericht is onverstaanbaar",
  "“We wachten op een tegemoetkomende trein”",
];

export const TRAIN_BINGO_LINES = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

export const createInitialTrainBingoSquares = () =>
  TRAIN_BINGO_TEXTS.map((_text, index) =>
    index === TRAIN_BINGO_FREE_INDEX ? "free" : "empty"
  );

export const normalizeTrainBingoSquares = (squares) => {
  const validStates = new Set(["empty", "green", "red", "free"]);

  if (!Array.isArray(squares) || squares.length !== TRAIN_BINGO_TEXTS.length) {
    return createInitialTrainBingoSquares();
  }

  return squares.map((state, index) => {
    if (index === TRAIN_BINGO_FREE_INDEX) {
      return "free";
    }

    return validStates.has(state) && state !== "free" ? state : "empty";
  });
};

export const getTrainBingoPlayerFromPassword = (password) => {
  if (password === "1") {
    return "green";
  }

  if (password === "2") {
    return "red";
  }

  return null;
};

export const getTrainBingoPasswordForPlayer = (player) => {
  if (player === "green") {
    return "1";
  }

  if (player === "red") {
    return "2";
  }

  return "";
};

export const canToggleTrainBingoSquare = (state, player) => {
  if (state === "free" || !player) {
    return false;
  }

  return state === "empty" || state === player;
};

export const toggleTrainBingoSquare = (squares, index, player) =>
  normalizeTrainBingoSquares(squares).map((state, stateIndex) => {
    if (stateIndex !== index || !canToggleTrainBingoSquare(state, player)) {
      return state;
    }

    return state === "empty" ? player : "empty";
  });

export const detectTrainBingo = (squares, player) => {
  const normalizedSquares = normalizeTrainBingoSquares(squares);

  return TRAIN_BINGO_LINES.some((line) =>
    line.every((index) => {
      const state = normalizedSquares[index];
      return state === player || state === "free";
    })
  );
};
