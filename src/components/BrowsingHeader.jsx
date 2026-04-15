import React from "react";
import { Box, Typography } from "@mui/material";

export default function BrowsingHeader() {
  return (
    <Box
      sx={{
        mb: 3,
        px: 2,
        py: 2.5,
        maxWidth: 860,
        width: "100%",
        borderRadius: 3,
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background: "rgba(20, 27, 33, 0.78)",
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
      }}
    >
      <Typography
        variant="overline"
        sx={{ color: "text.secondary", letterSpacing: "0.16em" }}
      >
        Explore
      </Typography>
      <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
        Browsing
      </Typography>
      <Typography variant="subtitle2" color="text.secondary">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </Typography>
    </Box>
  );
}
