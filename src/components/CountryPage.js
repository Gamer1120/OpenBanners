import React from "react";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  root: {
    display: "flex",
  },
  cityList: {
    flex: 1,
    backgroundColor: theme.palette.grey[800],
    padding: theme.spacing(2),
  },
  banners: {
    flex: 3,
    padding: theme.spacing(2),
  },
}));

const CountryPage = () => {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <div className={classes.cityList}>
        {/* Placeholder for city list */}
        <h2>City List</h2>
      </div>
      <div className={classes.banners}>
        {/* Placeholder for banners */}
        <h2>Banners</h2>
      </div>
    </div>
  );
};

export default CountryPage;
