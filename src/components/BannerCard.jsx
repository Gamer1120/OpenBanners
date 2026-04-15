import React from "react";
import { Link } from "react-router-dom";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { getBannerListType, useBannergressSync } from "../bannergressSync";
import { getBannergressCardSurface } from "../bannergressCardStyles";

function formatDistance(lengthMeters) {
  return Number.isFinite(lengthMeters)
    ? `${Math.round((lengthMeters / 1000) * 10) / 10} km`
    : "Unknown distance";
}

export default function BannerCard({ banner }) {
  const syncState = useBannergressSync();
  const effectiveListType = getBannerListType(
    syncState,
    banner.id,
    banner.listType
  );
  const cardSurface = getBannergressCardSurface(effectiveListType);
  const lengthMeters = Number(banner.lengthMeters);
  const missions = Number(banner.numberOfMissions);
  const showImage = Boolean(banner.picture);
  const efficiency =
    Number.isFinite(missions) && Number.isFinite(lengthMeters) && lengthMeters > 0
      ? `${((missions / lengthMeters) * 1000).toFixed(3)} /km`
      : "Unavailable";

  return (
    <Link
      to={`/banner/${banner.id}`}
      style={{
        textDecoration: "none",
        display: "block",
        width: "100%",
        height: "100%",
      }}
    >
      <Card
        sx={{
          width: "100%",
          maxWidth: 360,
          display: "flex",
          height: "100%",
          borderRadius: 3,
          overflow: "hidden",
          bgcolor: cardSurface.backgroundColor,
          backgroundImage: cardSurface.backgroundImage,
          border: `1px solid ${cardSurface.borderColor}`,
          boxShadow: "0 16px 34px rgba(0,0,0,0.18)",
        }}
      >
        <CardActionArea
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            height: "100%",
            transition:
              "transform 180ms ease, background-color 180ms ease, border-color 180ms ease",
            "&:hover": {
              transform: "translateY(-3px)",
              bgcolor: cardSurface.hoverBackgroundColor,
            },
          }}
        >
          <Box
            sx={{
              px: 2.25,
              pt: 2.25,
              pb: 1.25,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 1.5,
            }}
          >
            <Typography
              gutterBottom
              variant="h6"
              component="div"
              sx={{
                minHeight: 58,
                m: 0,
                lineHeight: 1.1,
                textAlign: "left",
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
              label={banner.numberOfDisabledMissions > 0 ? "Offline" : "Live"}
              sx={{
                flexShrink: 0,
                mt: 0.25,
                fontWeight: 600,
                color: "text.secondary",
                bgcolor:
                  banner.numberOfDisabledMissions > 0
                    ? "rgba(255, 255, 255, 0.06)"
                    : "rgba(255, 255, 255, 0.04)",
                border:
                  banner.numberOfDisabledMissions > 0
                    ? "1px solid rgba(255, 255, 255, 0.12)"
                    : "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 1,
              }}
            />
          </Box>

          <Box
            sx={{
              position: "relative",
              mx: 2,
              mb: 1.75,
              borderRadius: 2,
              overflow: "hidden",
              pt: "66.6667%",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {showImage ? (
              <CardMedia
                component="img"
                image={`https://api.bannergress.com${banner.picture}`}
                alt={banner.title}
                sx={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  width: "auto",
                  height: "auto",
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
                  color: "text.secondary",
                }}
              >
                <Typography variant="body2">No image available</Typography>
              </Box>
            )}
          </Box>

          <CardContent sx={{ mt: "auto", textAlign: "left", px: 2.25, pb: 2.25 }}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.25 }}>
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

            <Typography variant="body2" color="text.secondary">
              {banner.formattedAddress || "Address unavailable"}
            </Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    </Link>
  );
}
