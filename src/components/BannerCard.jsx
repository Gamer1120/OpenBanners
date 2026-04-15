import React from "react";
import { Link } from "react-router-dom";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Typography,
} from "@mui/material";

export default function BannerCard({ banner }) {
  const lengthMeters = Number(banner.lengthMeters);
  const missions = Number(banner.numberOfMissions);
  const showImage = Boolean(banner.picture);

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
          maxWidth: 345,
          m: 2,
          display: "flex",
          height: "100%",
        }}
      >
        <CardActionArea
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            height: "100%",
          }}
        >
          <Typography
            gutterBottom
            variant="h6"
            component="div"
            sx={{ px: 2, pt: 2, minHeight: 64 }}
          >
            {banner.title}
          </Typography>

          <Box sx={{ position: "relative", pt: "66.6667%", overflow: "hidden" }}>
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
            {banner.numberOfDisabledMissions > 0 && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(0, 0, 0, 0.7)",
                  color: "#fff",
                  fontSize: 24,
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                <Typography variant="body1">Banner Offline</Typography>
              </Box>
            )}
          </Box>
          <CardContent sx={{ mt: "auto", textAlign: "left" }}>
            <Typography variant="body2" color="text.secondary">
              {Number.isFinite(missions) ? missions : "Unknown"} Missions,{" "}
              {Number.isFinite(lengthMeters)
                ? `${Math.round((lengthMeters / 1000) * 10) / 10} km`
                : "Unknown distance"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Efficiency:{" "}
              {Number.isFinite(missions) && Number.isFinite(lengthMeters) && lengthMeters > 0
                ? `${((missions / lengthMeters) * 1000).toFixed(3)} missions/km`
                : "Unavailable"}
            </Typography>

            <Typography variant="body2" color="text.secondary">
              {banner.formattedAddress || "Address unavailable"}
            </Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    </Link>
  );
}
