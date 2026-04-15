import React from "react";
import { Typography } from "@mui/material";

export default function BrowsingHeader() {
  return (
    <>
      <Typography variant="subtitle2" color="textSecondary">
        This website is not associated with Bannergress, Ingress and/or Niantic.
        This website is an alternative, open-source front-end for Bannergress's
        back-end.
      </Typography>
      <Typography variant="h5">Browsing</Typography>
    </>
  );
}
