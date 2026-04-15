import React from "react";
import { Box, Button, CircularProgress, Skeleton, Stack, Typography } from "@mui/material";
import { updateBannergressBannerListType } from "../bannergressSync";

const bannerListActions = [
  {
    listType: "todo",
    label: "To do",
    activeSx: {
      color: "#eef7ff",
      bgcolor: "#245074",
      borderColor: "rgba(146, 214, 255, 0.42)",
      "&:hover": {
        bgcolor: "#2a608d",
      },
    },
    idleSx: {
      color: "#cde6ff",
      borderColor: "rgba(146, 214, 255, 0.24)",
      bgcolor: "rgba(20, 35, 48, 0.44)",
      "&:hover": {
        borderColor: "rgba(146, 214, 255, 0.38)",
        bgcolor: "rgba(34, 58, 80, 0.6)",
      },
    },
  },
  {
    listType: "done",
    label: "Done",
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
    label: "Hide",
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
  const styles = getLayoutStyles(layout);

  const handleBannerListAction = async (nextListType) => {
    if (!bannerId || !canUpdateBannerList || pendingListType) {
      return;
    }

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
          ? "Authenticate again."
          : "Update failed."
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
              sx={{
                minWidth: 0,
                borderRadius: 1.75,
                fontWeight: 800,
                lineHeight: 1.15,
                textTransform: "none",
                boxShadow: "none",
                ...action.idleSx,
                ...(isActive ? action.activeSx : null),
                ...styles.buttonSx,
                "&.Mui-disabled": {
                  color: "rgba(255,255,255,0.46)",
                  borderColor: "rgba(255,255,255,0.1)",
                  bgcolor: "rgba(255,255,255,0.05)",
                },
              }}
            >
              {isPending ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                action.label
              )}
            </Button>
          );
        })}
      </Stack>
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
