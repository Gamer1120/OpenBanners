import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import BannerCard from "./BannerCard";

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
      <div className={classes.bannerContainer}>
        {banners.map((banner) => (
          <BannerCard key={banner.id} banner={banner} />
        ))}
      </div>
    </div>
  );
}
