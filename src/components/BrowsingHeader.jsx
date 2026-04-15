import React from "react";
import { Box, Typography } from "@mui/material";

export default function BrowsingHeader() {
  return (
    <Box sx={{ mb: 2, px: 1, maxWidth: 720 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </Typography>
      <Typography variant="h5" component="h1">
        Browsing
      </Typography>
    </Box>
  );
}
