import React from "react";
import { Box, Button, CircularProgress, Skeleton, Stack, Typography } from "@mui/material";
import {
  BANNERGRESS_AUTH_REQUEST_EVENT,
  isSignedInToBannergress,
  updateBannergressBannerListType,
  useBannergressAuth,
} from "../bannergressSync";
import { t, tk } from "../i18n";

// Light (design X) theme: outlined M3 segmented look; dark keeps the original tints.
const LIGHT_IDLE_SX = {
  color: "var(--on-surface)",
  borderColor: "var(--outline)",
  bgcolor: "transparent",
  "&:hover": {
    borderColor: "var(--outline)",
    bgcolor: "var(--sc-high)",
  },
};

const bannerListActions = [
  {
    listType: "todo",
    label: tk("To do"),
    activeSx: {
      color: "#2f2200",
      bgcolor: "#f2b63d",
      borderColor: "rgba(255, 214, 122, 0.5)",
      "&:hover": {
        bgcolor: "#f7c24f",
      },
    },
    idleSx: {
      color: "#f6d48a",
      borderColor: "rgba(255, 214, 122, 0.28)",
      bgcolor: "rgba(74, 50, 10, 0.44)",
      "&:hover": {
        borderColor: "rgba(255, 214, 122, 0.42)",
        bgcolor: "rgba(110, 74, 14, 0.58)",
      },
    },
  },
  {
    listType: "done",
    label: tk("Done"),
    activeSx: {
      color: "#efffe7",
      bgcolor: "#2f6a38",
      borderColor: "rgba(167, 255, 170, 0.4)",
      "&:hover": {
        bgcolor: "#3b8447",
      },
    },
    idleSx: {
      color: "#d5f6d5",
      borderColor: "rgba(167, 255, 170, 0.24)",
      bgcolor: "rgba(22, 40, 24, 0.42)",
      "&:hover": {
        borderColor: "rgba(167, 255, 170, 0.36)",
        bgcolor: "rgba(39, 67, 42, 0.58)",
      },
    },
  },
  {
    listType: "blacklist",
    label: tk("Hide"),
    activeSx: {
      color: "#fff1f1",
      bgcolor: "#7a2b2b",
      borderColor: "rgba(255, 170, 170, 0.42)",
      "&:hover": {
        bgcolor: "#903535",
      },
    },
    idleSx: {
      color: "#ffd6d6",
      borderColor: "rgba(255, 170, 170, 0.24)",
      bgcolor: "rgba(46, 22, 22, 0.42)",
      "&:hover": {
        borderColor: "rgba(255, 170, 170, 0.38)",
        bgcolor: "rgba(76, 34, 34, 0.58)",
      },
    },
  },
];

function getLayoutStyles(layout) {
  if (layout === "horizontal") {
    return {
      containerSx: {
        width: "100%",
      },
      stackDirection: "row",
      stackSx: {
        width: "100%",
      },
      buttonSx: {
        flex: 1,
        minHeight: 44,
        px: 1,
        py: 0.9,
        fontSize: { xs: "0.8rem", sm: "0.86rem" },
      },
      skeletonSx: {
        flex: 1,
        minHeight: 44,
      },
      errorSx: {
        pt: 0.75,
        textAlign: "left",
      },
    };
  }

  return {
    containerSx: {
      minWidth: { xs: 100, sm: 114 },
      alignSelf: "stretch",
      display: "flex",
      flexDirection: "column",
      justifyContent: "stretch",
      py: { xs: 0.1, sm: 0.15 },
    },
    stackDirection: "column",
    stackSx: {
      flex: 1,
      minHeight: 0,
    },
    buttonSx: {
      flex: 1,
      minWidth: 0,
      minHeight: { xs: 54, sm: 62 },
      px: 0.85,
      py: 0.9,
      fontSize: { xs: "0.8rem", sm: "0.86rem" },
    },
    skeletonSx: {
      width: "100%",
      flex: 1,
      minHeight: { xs: 54, sm: 62 },
    },
    errorSx: {
      pt: 0.6,
      textAlign: "right",
    },
  };
}

export function BannergressListActionsSkeleton({ layout = "vertical" }) {
  const styles = getLayoutStyles(layout);

  return (
    <Stack
      direction={styles.stackDirection}
      spacing={0.75}
      sx={styles.containerSx}
    >
      {bannerListActions.map((action) => (
        <Skeleton
          key={action.listType}
          variant="rounded"
          sx={{
            borderRadius: 1.75,
            transform: "none",
            ...styles.skeletonSx,
          }}
        />
      ))}
    </Stack>
  );
}

export default function BannergressListActions({
  bannerId,
  effectiveListType,
  canUpdateBannerList,
  layout = "vertical",
}) {
  const [pendingListType, setPendingListType] = React.useState(null);
  const [listActionError, setListActionError] = React.useState("");
  const [askedToSignIn, setAskedToSignIn] = React.useState(false);
  const auth = useBannergressAuth();
  const signedIn = Boolean(auth?.accessToken || auth?.refreshToken);
  const styles = getLayoutStyles(layout);

  const handleBannerListAction = async (nextListType) => {
    if (!bannerId || !canUpdateBannerList || pendingListType) {
      return;
    }

    // Signed out: say so (with a Sign in button) instead of sending a request
    // that can only fail.
    if (!isSignedInToBannergress()) {
      setListActionError("");
      setAskedToSignIn(true);
      return;
    }

    setAskedToSignIn(false);

    const requestedListType =
      effectiveListType === nextListType ? "none" : nextListType;

    setPendingListType(nextListType);
    setListActionError("");

    try {
      await updateBannergressBannerListType(bannerId, requestedListType, {
        keepHiddenVisible: requestedListType === "blacklist",
      });
    } catch (error) {
      console.error("Couldn't update Bannergress list type.", error);
      setListActionError(
        error?.status === 401 || error?.status === 403
          ? t("Authenticate again.")
          : t("Update failed.")
      );
    } finally {
      setPendingListType(null);
    }
  };

  return (
    <Box sx={styles.containerSx}>
      <Stack
        direction={styles.stackDirection}
        spacing={0.75}
        sx={styles.stackSx}
      >
        {bannerListActions.map((action) => {
          const isActive = effectiveListType === action.listType;
          const isPending = pendingListType === action.listType;

          return (
            <Button
              key={action.listType}
              size="medium"
              variant={isActive ? "contained" : "outlined"}
              aria-pressed={isActive}
              disabled={!canUpdateBannerList || Boolean(pendingListType)}
              onClick={() => {
                handleBannerListAction(action.listType);
              }}
              sx={(theme) => {
                const light = theme.palette.mode === "light";

                return {
                  minWidth: 0,
                  borderRadius: light ? 5 : 1.75,
                  fontWeight: light ? 600 : 800,
                  lineHeight: 1.15,
                  textTransform: "none",
                  boxShadow: "none",
                  ...(light ? LIGHT_IDLE_SX : action.idleSx),
                  ...(isActive ? action.activeSx : null),
                  ...styles.buttonSx,
                  "&.Mui-disabled": isActive
                    ? {
                        // Signed out / pending: still show which list it is on.
                        color: action.activeSx.color,
                        bgcolor: action.activeSx.bgcolor,
                        borderColor: action.activeSx.borderColor,
                        opacity: 0.8,
                      }
                    : light
                    ? {
                        color: "rgba(0,0,0,0.38)",
                        borderColor: "rgba(0,0,0,0.12)",
                        bgcolor: "transparent",
                      }
                    : {
                        color: "rgba(255,255,255,0.46)",
                        borderColor: "rgba(255,255,255,0.1)",
                        bgcolor: "rgba(255,255,255,0.05)",
                      },
                };
              }}
            >
              {isPending ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                t(action.label)
              )}
            </Button>
          );
        })}
      </Stack>
      {askedToSignIn && !signedIn ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
            pt: 0.75,
          }}
        >
          <Typography role="status" variant="body2" sx={{ flex: "1 1 12em", color: "var(--on-surface-variant)" }}>
            {t("Sign in to use To do, Done and Hide.")}
          </Typography>
          <button
            type="button"
            className="btn filled sl"
            onClick={() => window.dispatchEvent(new Event(BANNERGRESS_AUTH_REQUEST_EVENT))}
          >
            {t("Sign in")}
          </button>
        </Box>
      ) : null}
      {listActionError ? (
        <Typography
          variant="caption"
          color="error.main"
          sx={{
            display: "block",
            lineHeight: 1.25,
            ...styles.errorSx,
          }}
        >
          {listActionError}
        </Typography>
      ) : null}
    </Box>
  );
}
