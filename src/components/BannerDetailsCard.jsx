import React from "react";
import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Skeleton,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import BannergressListActions from "./BannergressListActions";
import {
  getBannerListType,
  isBannergressBridgePresent,
  useBannergressSync,
} from "../bannergressSync";
import { getBannergressCardSurface } from "../bannergressCardStyles";

function formatDistance(lengthMeters) {
  return Number.isFinite(lengthMeters)
    ? `${Math.round((lengthMeters / 1000) * 10) / 10} km`
    : "Unknown distance";
}

export default function BannerDetailsCard({ banner, loading = false }) {
  const isMobile = useMediaQuery("(max-width:768px)");
  const syncState = useBannergressSync();
  const effectiveListType = loading
    ? null
    : getBannerListType(syncState, banner.id, banner.listType);
  const cardSurface = getBannergressCardSurface(effectiveListType);
  const lengthMeters = Number(banner.lengthMeters);
  const missions = Number(banner.numberOfMissions);
  const showImage = Boolean(banner.picture);
  const efficiency =
    Number.isFinite(missions) && Number.isFinite(lengthMeters) && lengthMeters > 0
      ? `${((missions / lengthMeters) * 1000).toFixed(3)} /km`
      : "Unavailable";
  const canUpdateBannerList = loading ? false : isBannergressBridgePresent();

  return (
    <Card
      sx={{
        width: "100%",
        maxWidth: isMobile ? "none" : 420,
        m: isMobile ? 1 : 2,
        display: "flex",
        flexDirection: "column",
        borderRadius: 3,
        overflow: "hidden",
        bgcolor: cardSurface.backgroundColor,
        backgroundImage: cardSurface.backgroundImage,
        border: `1px solid ${cardSurface.borderColor}`,
        boxShadow: "0 16px 34px rgba(0,0,0,0.18)",
      }}
    >
      <Box sx={{ px: 2.5, pt: 2.5, pb: 1.5 }}>
        <Typography
          gutterBottom
          variant="h5"
          component="div"
          sx={{
            minHeight: 64,
            m: 0,
            textAlign: "left",
            lineHeight: 1.05,
          }}
        >
          {loading ? <Skeleton width="80%" /> : banner.title}
        </Typography>
      </Box>

      <Box
        sx={{
          position: "relative",
          mx: 2.5,
          mb: 2,
          borderRadius: 2,
          overflow: "hidden",
          pt: "66.6667%",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {loading ? (
          <Skeleton
            variant="rectangular"
            sx={{ position: "absolute", inset: 0 }}
          />
        ) : showImage ? (
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
      <CardContent sx={{ textAlign: "left", px: 2.5, pb: 2.5 }}>
        {loading ? (
          <>
            <Skeleton width="72%" />
            <Skeleton width="56%" />
            <Skeleton width="68%" />
          </>
        ) : (
          <>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
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
            <Box sx={{ mt: 2 }}>
              <BannergressListActions
                bannerId={banner.id}
                effectiveListType={effectiveListType}
                canUpdateBannerList={canUpdateBannerList}
                layout="horizontal"
              />
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
