import React from "react";
import { Link } from "react-router-dom";
import {
  Box,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";

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
          p: { xs: 1.25, sm: 1.5 },
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.08)",
          bgcolor: "rgba(20, 27, 33, 0.72)",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "82px 1fr", sm: "104px 1fr 88px" },
            gap: { xs: 1.25, sm: 1.75 },
            alignItems: "center",
          }}
        >
          <Skeleton
            variant="rounded"
            sx={{ width: "100%", aspectRatio: "2 / 3", transform: "none" }}
          />
          <Stack spacing={1}>
            <Skeleton variant="text" width="72%" height={34} />
            <Skeleton variant="text" width="48%" />
            <Stack direction="row" spacing={0.75}>
              <Skeleton variant="rounded" width={74} height={26} />
              <Skeleton variant="rounded" width={84} height={26} />
              <Skeleton
                variant="rounded"
                width={72}
                height={26}
                sx={{ display: { xs: "none", sm: "block" } }}
              />
            </Stack>
          </Stack>
          <Stack
            spacing={1}
            alignItems="flex-end"
            sx={{ display: { xs: "none", sm: "flex" } }}
          >
            <Skeleton variant="rounded" width={70} height={26} />
            <Skeleton variant="text" width={36} />
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
          p: { xs: 1.25, sm: 1.5 },
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.08)",
          bgcolor: "rgba(20, 27, 33, 0.72)",
          transition:
            "transform 180ms ease, border-color 180ms ease, background-color 180ms ease",
          "&:hover": {
            transform: "translateY(-1px)",
            borderColor: "rgba(255,255,255,0.18)",
            bgcolor: "rgba(24, 31, 38, 0.9)",
          },
          "&:focus-within": {
            borderColor: "primary.main",
          },
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "82px 1fr", sm: "104px 1fr 88px" },
            gap: { xs: 1.25, sm: 1.75 },
            alignItems: "center",
          }}
        >
          <Box
            sx={{
              position: "relative",
              aspectRatio: "2 / 3",
              borderRadius: 1.5,
              overflow: "hidden",
              bgcolor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {showImage ? (
              <Box
                component="img"
                src={`https://api.bannergress.com${banner.picture}`}
                alt={banner.title}
                sx={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
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
                <Typography variant="caption" color="text.secondary">
                  No image
                </Typography>
              </Box>
            )}
          </Box>

          <Stack spacing={0.85} sx={{ minWidth: 0 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={0.75}
              alignItems={{ xs: "flex-start", sm: "center" }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: "1rem", sm: "1.1rem" },
                  lineHeight: 1.15,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {banner.title}
              </Typography>
              <Chip
                size="small"
                label={isOffline ? "Offline" : "Live"}
                sx={{
                  display: { xs: "inline-flex", sm: "none" },
                  borderRadius: 1,
                  bgcolor: "rgba(255,255,255,0.04)",
                  color: "text.secondary",
                }}
              />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              {banner.formattedAddress || "Address unavailable"}
            </Typography>

            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                label={`${Number.isFinite(missions) ? missions : "?"} missions`}
                sx={{ bgcolor: "rgba(255,255,255,0.04)", borderRadius: 1 }}
              />
              <Chip
                size="small"
                label={formatDistance(lengthMeters)}
                sx={{ bgcolor: "rgba(255,255,255,0.04)", borderRadius: 1 }}
              />
              <Chip
                size="small"
                label={efficiency}
                sx={{ bgcolor: "rgba(255,255,255,0.04)", borderRadius: 1 }}
              />
            </Stack>
          </Stack>

          <Stack
            spacing={1}
            alignItems="flex-end"
            justifyContent="center"
            sx={{ display: { xs: "none", sm: "flex" } }}
          >
            <Chip
              size="small"
              label={isOffline ? "Offline" : "Live"}
              sx={{
                borderRadius: 1,
                bgcolor: "rgba(255,255,255,0.04)",
                color: "text.secondary",
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Open
            </Typography>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
