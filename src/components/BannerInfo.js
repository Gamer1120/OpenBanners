import React from "react";
import PropTypes from "prop-types";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  bannerInfo: {
    backgroundColor: "#f9f9f9",
    padding: theme.spacing(2),
    marginTop: theme.spacing(2),
  },
  title: {
    fontSize: 20,
    marginBottom: theme.spacing(1),
  },
  description: {
    fontSize: 16,
    lineHeight: 1.5,
  },
}));

const BannerInfo = ({ description }) => {
  const classes = useStyles();

  return (
    <div className={classes.bannerInfo}>
      <h2 className={classes.title}>Description</h2>
      <p className={classes.description}>{description}</p>
    </div>
  );
};

BannerInfo.propTypes = {
  description: PropTypes.string.isRequired,
};

export default BannerInfo;
