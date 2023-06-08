import React from "react";
import { makeStyles } from "@mui/styles";
import TopMenu from "./TopMenu";
import BannersNearMe from "./BannersNearMe";

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.grey[900],
    minHeight: "100vh",
  },
}));

export default function Home() {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <TopMenu />
      <BannersNearMe />
    </div>
  );
}
