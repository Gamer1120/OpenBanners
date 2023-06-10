import React from "react";
import { Typography } from "@mui/material";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  browsingHeader: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
    color: "white",
  },
}));

export default function BrowsingPage() {
  const classes = useStyles();

  return (
    <Typography variant="h5" className={classes.browsingHeader}>
      Browsing
    </Typography>
  );
}
