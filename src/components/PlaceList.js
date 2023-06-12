// src/components/PlaceList.js
import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import { Link, useParams } from "react-router-dom";

const useStyles = makeStyles((theme) => ({
  placeList: {
    marginRight: theme.spacing(2),
    minWidth: "150px", // Optional: Adjust the width as needed
  },
  placeItem: {
    marginBottom: theme.spacing(0.2), // Adjust the spacing as desired
    cursor: "pointer",
    textAlign: "left", // Align the place names to the left
  },
  placeLink: {
    textDecoration: "none",
    color: "#FFF",
    fontSize: "12px",
  },
}));

export default function PlaceList() {
  const classes = useStyles();
  const { placeId } = useParams();
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    fetch(
      `https://api.bannergress.com/places?used=true&parentPlaceId=${placeId}`
    )
      .then((response) => response.json())
      .then((data) => setPlaces(data))
      .catch((error) => console.error(error));
  }, [placeId]);

  return (
    <div className={classes.placeList}>
      {places.map((place) => (
        <div key={place.id} className={classes.placeItem}>
          <Link to={`/browse/${place.id}`} className={classes.placeLink}>
            {place.formattedAddress} ({place.numberOfBanners})
          </Link>
        </div>
      ))}
    </div>
  );
}
