import React from "react";
import { Link } from "react-router-dom";
import { Box, Chip, Paper, Skeleton, Stack, Typography } from "@mui/material";

function formatDistance(lengthMeters) {
  return Number.isFinite(lengthMeters)
    ? `${Math.round((lengthMeters / 1000) * 10) / 10} km`
    : "Unknown distance";
}

export default function BannerListItem({ banner, loading = false }) {
  if (loading) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: { xs: 0.75, sm: 0.9 },
          borderRadius: 3,
          border: "1px solid rgba(255,255,255,0.08)",
          bgcolor: "rgba(18, 25, 31, 0.78)",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(148px, 46%) minmax(0, 1fr)",
              sm: "minmax(224px, 42%) minmax(0, 1fr)",
            },
            gap: { xs: 0.9, sm: 1.1 },
            alignItems: "stretch",
          }}
        >
          <Skeleton
            variant="rounded"
            sx={{
              width: "100%",
              height: "100%",
              minHeight: { xs: 186, sm: 214 },
              borderRadius: 2.5,
              transform: "none",
            }}
          />
          <Stack
            spacing={0.8}
            justifyContent="center"
            sx={{
              minWidth: 0,
              py: { xs: 0.35, sm: 0.5 },
              pr: { xs: 0.25, sm: 0.4 },
            }}
          >
            <Skeleton variant="text" width="82%" height={38} />
            <Skeleton variant="text" width="64%" height={22} />
            <Skeleton variant="text" width="76%" height={20} />
          </Stack>
        </Box>
      </Paper>
    );
  }

  const lengthMeters = Number(banner.lengthMeters);
  const missions = Number(banner.numberOfMissions);
  const isOffline = Number(banner.numberOfDisabledMissions) > 0;
  const showImage = Boolean(banner.picture);
  const efficiency =
    Number.isFinite(missions) && Number.isFinite(lengthMeters) && lengthMeters > 0
      ? `${((missions / lengthMeters) * 1000).toFixed(3)} /km`
      : "Unavailable";

  return (
    <Box
      component={Link}
      to={`/banner/${banner.id}`}
      sx={{
        display: "block",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          p: { xs: 0.75, sm: 0.9 },
          borderRadius: 3,
          border: "1px solid rgba(255,255,255,0.08)",
          bgcolor: "rgba(18, 25, 31, 0.78)",
          overflow: "hidden",
          transition:
            "transform 180ms ease, border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease",
          boxShadow: "0 14px 34px rgba(0,0,0,0.16)",
          "&:hover": {
            transform: "translateY(-2px)",
            borderColor: "rgba(255,255,255,0.18)",
            bgcolor: "rgba(24, 31, 38, 0.92)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.2)",
            "& .banner-list-item-image": {
              transform: "scale(1.03)",
            },
          },
          "&:focus-within": {
            borderColor: "primary.main",
          },
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(148px, 46%) minmax(0, 1fr)",
              sm: "minmax(224px, 42%) minmax(0, 1fr)",
            },
            gap: { xs: 0.9, sm: 1.1 },
            alignItems: "stretch",
          }}
        >
          <Box
            sx={{
              position: "relative",
              minHeight: { xs: 186, sm: 214 },
              borderRadius: 2.5,
              overflow: "hidden",
              bgcolor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              backgroundImage:
                "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
            }}
          >
            {isOffline ? (
              <Chip
                size="small"
                label="Offline"
                sx={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  zIndex: 1,
                  height: 24,
                  fontWeight: 600,
                  color: "#ffd8b2",
                  bgcolor: "rgba(120, 60, 28, 0.78)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  backdropFilter: "blur(8px)",
                }}
              />
            ) : null}
            {showImage ? (
              <Box
                component="img"
                className="banner-list-item-image"
                src={`https://api.bannergress.com${banner.picture}`}
                alt={banner.title}
                sx={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  transition: "transform 220ms ease",
                }}
              />
            ) : (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  px: 1,
                  textAlign: "center",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  No image
                </Typography>
              </Box>
            )}
          </Box>

          <Stack
            spacing={0.8}
            justifyContent="center"
            sx={{
              minWidth: 0,
              py: { xs: 0.35, sm: 0.5 },
              pr: { xs: 0.25, sm: 0.4 },
            }}
          >
            <Typography
              variant="h6"
              sx={{
                fontSize: { xs: "1rem", sm: "1.12rem" },
                lineHeight: 1.15,
                minWidth: 0,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                fontWeight: 700,
              }}
            >
              {banner.title}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.35,
              }}
            >
              {banner.formattedAddress || "Address unavailable"}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                fontSize: { xs: "0.82rem", sm: "0.88rem" },
                lineHeight: 1.35,
              }}
            >
              {`${Number.isFinite(missions) ? missions : "?"} missions • ${formatDistance(
                lengthMeters
              )} • ${efficiency}`}
            </Typography>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
