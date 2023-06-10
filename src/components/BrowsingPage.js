import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  browsingContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    color: theme.palette.common.white,
    fontSize: "24px",
  },
  bannerContainer: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: theme.spacing(2),
  },
  banner: {
    width: "200px",
    height: "200px",
    margin: theme.spacing(1),
    backgroundColor: theme.palette.primary.main,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: theme.palette.common.white,
    fontSize: "24px",
  },
}));

export default function BrowsingPage() {
  const classes = useStyles();
  const [banners, setBanners] = useState([]);

  useEffect(() => {
    fetch(
      "https://api.bannergress.com/bnrs?orderBy=created&orderDirection=DESC&online=true&limit=9&offset=0"
    )
      .then((response) => response.json())
      .then((data) => setBanners(data))
      .catch((error) => console.error(error));
  }, []);

  return (
    <div className={classes.browsingContainer}>
      <div>Browsing</div>
      <pre>{JSON.stringify(banners, null, 2)}</pre>
    </div>
  );
}
