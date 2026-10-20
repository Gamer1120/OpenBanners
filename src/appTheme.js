import { createTheme } from "@mui/material/styles";

const DISPLAY_FONT = '"Twemoji Country Flags", Roboto, "Google Sans Text", system-ui, -apple-system, "Segoe UI", sans-serif';

export function buildAppTheme(mode) {
  const dark = mode === "dark";

  return createTheme({
    palette: dark
      ? {
          mode: "dark",
          primary: { main: "#c3c0ff", light: "#e2dfff", contrastText: "#2a2860" },
          secondary: { main: "#c7c4dc" },
          background: { default: "#16161c", paper: "#1e1e26" },
          text: { primary: "#e6e3ef", secondary: "#c4c1d2" },
        }
      : {
          mode: "light",
          primary: { main: "#4d4e8f", light: "#7a7bbd", contrastText: "#ffffff" },
          secondary: { main: "#5d5c72" },
          background: { default: "#f8f7fc", paper: "#f2f1f8" },
          text: { primary: "#1c1b22", secondary: "#55536a" },
        },
    shape: {
      borderRadius: 12,
    },
    typography: {
      fontFamily: DISPLAY_FONT,
      button: {
        fontWeight: 500,
        letterSpacing: "0.02em",
        textTransform: "none",
      },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            boxShadow: "none",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            borderRadius: 20,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
          },
        },
      },
    },
  });
}
