import React from "react";
import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Skeleton,
  Typography,
} from "@mui/material";

export default function BannerDetailsCard({ banner, loading = false }) {
  const lengthMeters = Number(banner.lengthMeters);
  const missions = Number(banner.numberOfMissions);
  const showImage = Boolean(banner.picture);

  return (
    <Card
      sx={{
        width: "100%",
        maxWidth: 345,
        m: 2,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Typography
        gutterBottom
        variant="h6"
        component="div"
        sx={{ px: 2, pt: 2, minHeight: 64 }}
      >
        {loading ? <Skeleton width="80%" /> : banner.title}
      </Typography>

      <Box sx={{ position: "relative", pt: "66.6667%", overflow: "hidden" }}>
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
      <CardContent sx={{ textAlign: "left" }}>
        <Typography variant="body2" color="text.secondary">
          {loading ? (
            <Skeleton width="70%" />
          ) : (
            <>
              {Number.isFinite(missions) ? missions : "Unknown"} Missions,{" "}
              {Number.isFinite(lengthMeters)
                ? `${Math.round((lengthMeters / 1000) * 10) / 10} km`
                : "Unknown distance"}
            </>
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {loading ? (
            <Skeleton width="65%" />
          ) : (
            <>
              Efficiency:{" "}
              {Number.isFinite(missions) &&
              Number.isFinite(lengthMeters) &&
              lengthMeters > 0
                ? `${((missions / lengthMeters) * 1000).toFixed(3)} missions/km`
                : "Unavailable"}
            </>
          )}
        </Typography>

        <Typography variant="body2" color="text.secondary">
          {loading ? (
            <Skeleton width="75%" />
          ) : (
            banner.formattedAddress || "Address unavailable"
          )}
        </Typography>
      </CardContent>
    </Card>
  );
}
