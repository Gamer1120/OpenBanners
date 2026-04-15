import React from "react";
import { Box, Card, CardContent, CardMedia, Typography } from "@mui/material";

export default function BannerDetailsCard({ banner }) {
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
      </Box>
      <CardContent sx={{ textAlign: "left" }}>
        <Typography variant="body2" color="text.secondary">
          {banner.numberOfMissions} Missions,{" "}
          {Math.round((banner.lengthMeters / 1000) * 10) / 10} km
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Efficiency:{" "}
          {((banner.numberOfMissions / banner.lengthMeters) * 1000).toFixed(3)}{" "}
          missions/km
        </Typography>

        <Typography variant="body2" color="text.secondary">
          {banner.formattedAddress}
        </Typography>
      </CardContent>
    </Card>
  );
}
