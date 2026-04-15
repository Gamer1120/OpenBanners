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
  return (
    <Link
      to={`/banner/${banner.id}`}
      style={{ textDecoration: "none", display: "block", width: "100%", height: "100%" }}
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
          sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", height: "100%" }}
        >
          <Typography gutterBottom variant="h6" component="div" sx={{ px: 2, pt: 2, minHeight: 64 }}>
            {banner.title}
          </Typography>

          <Box sx={{ position: "relative", pt: "66.6667%", overflow: "hidden" }}>
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
              {banner.numberOfMissions} Missions,{" "}
              {Math.round((banner.lengthMeters / 1000) * 10) / 10} km
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Efficiency:{" "}
              {((banner.numberOfMissions / banner.lengthMeters) * 1000).toFixed(
                3
              )}{" "}
              missions/km
            </Typography>

            <Typography variant="body2" color="text.secondary">
              {banner.formattedAddress}
            </Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    </Link>
  );
}
