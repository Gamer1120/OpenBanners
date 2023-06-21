import React from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Typography,
} from "@mui/material";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  card: {
    maxWidth: 345,
    margin: theme.spacing(2),
  },
  cardMediaWrapper: {
    position: "relative",
    paddingTop: "66.6667%", // 2:3 aspect ratio (height:width)
    overflow: "hidden",
  },
  cardMedia: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    maxWidth: "100%",
    maxHeight: "100%",
    width: "auto",
    height: "auto",
    objectFit: "contain",
  },
}));

export default function BannerCard({ banner }) {
  const classes = useStyles();

  return (
    <Link to={`/bannerguide/${banner.id}`} style={{ textDecoration: "none" }}>
      <Card className={classes.card}>
        <CardActionArea>
          <Typography gutterBottom variant="h6" component="div">
            {banner.title}
          </Typography>

          <div className={classes.cardMediaWrapper}>
            <CardMedia
              component="img"
              image={`https://api.bannergress.com${banner.picture}`}
              alt={banner.title}
              className={classes.cardMedia}
            />
          </div>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              {banner.numberOfMissions} Missions,{" "}
              {Math.round((banner.lengthMeters / 1000) * 10) / 10} km
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Efficiency:{" "}
              {((banner.numberOfMissions / banner.lengthMeters) * 1000).toFixed(
                3
              )}{" "}
              missions/km
            </Typography>

            <Typography variant="body2" color="text.secondary">
              {banner.formattedAddress}
            </Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    </Link>
  );
}
