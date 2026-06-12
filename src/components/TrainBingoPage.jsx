import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TRAIN_BINGO_STORAGE_KEY,
  TRAIN_BINGO_TEXTS,
  canToggleTrainBingoSquare,
  createInitialTrainBingoSquares,
  detectTrainBingo,
  getTrainBingoPasswordForPlayer,
  getTrainBingoPlayerFromPassword,
  normalizeTrainBingoSquares,
} from "../trainBingo";
import "./TrainBingoPage.css";

const API_URL = "/api/train-bingo";
const LIVE_REFRESH_INTERVAL_MS = 2000;

const PLAYER_LABELS = {
  green: "Groene speler",
  red: "Rode speler",
};

const createFallbackState = () => ({
  version: 0,
  updatedAt: null,
  squares: createInitialTrainBingoSquares(),
});

const parseApiError = async (response) => {
  const result = await response.json().catch(() => null);
  const message =
    typeof result?.error === "string"
      ? result.error
      : "Er ging iets mis met het opslaan.";

  return {
    message,
    state: result?.state ?? null,
  };
};

const fetchBoardState = async ({ signal } = {}) => {
  const response = await fetch(API_URL, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error("Het bingobord kon niet worden geladen.");
  }

  return response.json();
};

const saveBoardAction = async (payload) => {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const apiError = await parseApiError(response);
    const error = new Error(apiError.message);
    error.state = apiError.state;
    error.status = response.status;
    throw error;
  }

  return response.json();
};

const normalizeBoardState = (state) => ({
  version: Number.isInteger(state?.version) ? state.version : 0,
  updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : null,
  squares: normalizeTrainBingoSquares(state?.squares),
});

const TrainBingoPage = () => {
  const [boardState, setBoardState] = useState(createFallbackState);
  const [activePlayer, setActivePlayer] = useState(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const storedPlayer = window.localStorage.getItem(TRAIN_BINGO_STORAGE_KEY);
    return storedPlayer === "green" || storedPlayer === "red"
      ? storedPlayer
      : null;
  });
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savingIndex, setSavingIndex] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const greenHasBingo = useMemo(
    () => detectTrainBingo(boardState.squares, "green"),
    [boardState.squares]
  );
  const redHasBingo = useMemo(
    () => detectTrainBingo(boardState.squares, "red"),
    [boardState.squares]
  );

  const loadBoard = useCallback(async ({ signal, silent = false } = {}) => {
    if (!silent) {
      setIsLoading(true);
      setErrorMessage("");
    }

    try {
      const state = await fetchBoardState({ signal });
      setBoardState(normalizeBoardState(state));
    } catch (error) {
      if (error.name !== "AbortError") {
        setErrorMessage(error.message);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    loadBoard({ signal: abortController.signal });

    return () => abortController.abort();
  }, [loadBoard]);

  useEffect(() => {
    if (!activePlayer || isSaving) {
      return undefined;
    }

    let abortController = null;

    const refreshLiveBoard = () => {
      abortController?.abort();
      abortController = new AbortController();
      loadBoard({
        signal: abortController.signal,
        silent: true,
      });
    };

    const intervalId = window.setInterval(
      refreshLiveBoard,
      LIVE_REFRESH_INTERVAL_MS
    );

    return () => {
      window.clearInterval(intervalId);
      abortController?.abort();
    };
  }, [activePlayer, isSaving, loadBoard]);

  const handleLogin = (event) => {
    event.preventDefault();
    const player = getTrainBingoPlayerFromPassword(password);

    if (!player) {
      setLoginError("Dat wachtwoord klopt niet.");
      return;
    }

    window.localStorage.setItem(TRAIN_BINGO_STORAGE_KEY, player);
    setActivePlayer(player);
    setPassword("");
    setLoginError("");
    setStatusMessage(`Ingelogd als ${PLAYER_LABELS[player].toLowerCase()}.`);
    loadBoard({ silent: true });
  };

  const handleLogout = () => {
    window.localStorage.removeItem(TRAIN_BINGO_STORAGE_KEY);
    setActivePlayer(null);
    setPassword("");
    setLoginError("");
    setStatusMessage("Uitgelogd.");
  };

  const handleSquareClick = async (index) => {
    if (!activePlayer || isSaving || isLoading) {
      return;
    }

    const currentState = boardState.squares[index];

    if (!canToggleTrainBingoSquare(currentState, activePlayer)) {
      return;
    }

    setIsSaving(true);
    setSavingIndex(index);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const state = await saveBoardAction({
        action: "toggle",
        index,
        password: getTrainBingoPasswordForPlayer(activePlayer),
        version: boardState.version,
      });
      setBoardState(normalizeBoardState(state));
      setStatusMessage("Bord opgeslagen.");
    } catch (error) {
      if (error.state) {
        setBoardState(normalizeBoardState(error.state));
      }

      setErrorMessage(
        error.status === 409
          ? "Iemand anders was net sneller. Het bord is opnieuw geladen."
          : error.message
      );
    } finally {
      setIsSaving(false);
      setSavingIndex(null);
    }
  };

  return (
    <main className="train-bingo-page">
      <section className="train-bingo-header">
        <div>
          <p className="train-bingo-kicker">Internationale treinreis</p>
          <h1>Treinbingo</h1>
        </div>
        {activePlayer ? (
          <div className={`train-bingo-mode train-bingo-mode-${activePlayer}`}>
            {PLAYER_LABELS[activePlayer]}
          </div>
        ) : null}
      </section>

      {!activePlayer ? (
        <section className="train-bingo-login" aria-labelledby="train-bingo-login-title">
          <h2 id="train-bingo-login-title">Log in om vakjes te markeren</h2>
          <form onSubmit={handleLogin}>
            <label htmlFor="train-bingo-password">Wachtwoord</label>
            <div className="train-bingo-login-row">
              <input
                id="train-bingo-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button type="submit">Inloggen</button>
            </div>
            {loginError ? <p className="train-bingo-error">{loginError}</p> : null}
          </form>
        </section>
      ) : (
        <>
          <section className="train-bingo-toolbar" aria-live="polite">
            <div>
              {isLoading ? "Bord laden..." : null}
              {isSaving ? "Opslaan..." : null}
              {!isLoading && !isSaving && statusMessage ? statusMessage : null}
              {!isLoading && !isSaving && !statusMessage && boardState.updatedAt
                ? `Laatste update: ${new Date(boardState.updatedAt).toLocaleTimeString(
                    "nl-NL",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )}`
                : null}
            </div>
            <div className="train-bingo-actions">
              <button type="button" onClick={() => loadBoard()} disabled={isLoading || isSaving}>
                Vernieuwen
              </button>
              <button type="button" onClick={handleLogout}>
                Uitloggen
              </button>
            </div>
          </section>

          <section className="train-bingo-bingo-messages" aria-live="polite">
            {greenHasBingo ? (
              <p className="train-bingo-win train-bingo-win-green">Groen heeft bingo.</p>
            ) : null}
            {redHasBingo ? (
              <p className="train-bingo-win train-bingo-win-red">Rood heeft bingo.</p>
            ) : null}
          </section>

          {errorMessage ? <p className="train-bingo-error">{errorMessage}</p> : null}

          <section className="train-bingo-grid" aria-label="Treinbingo bord">
            {TRAIN_BINGO_TEXTS.map((text, index) => {
              const state = boardState.squares[index];
              const canToggle = canToggleTrainBingoSquare(state, activePlayer);
              const isOpponentSquare =
                (activePlayer === "green" && state === "red") ||
                (activePlayer === "red" && state === "green");

              return (
                <button
                  key={text}
                  type="button"
                  className={[
                    "train-bingo-square",
                    `train-bingo-square-${state}`,
                    isOpponentSquare ? "train-bingo-square-opponent" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => handleSquareClick(index)}
                  disabled={!canToggle || isSaving || isLoading}
                  aria-pressed={state === "green" || state === "red" || state === "free"}
                >
                  <span>{text}</span>
                  {savingIndex === index ? (
                    <span className="train-bingo-saving">Opslaan</span>
                  ) : null}
                </button>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
};

export default TrainBingoPage;
