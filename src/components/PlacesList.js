import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import { Link, useParams } from "react-router-dom";
import flags from "./CountryFlags";

const useStyles = makeStyles((theme) => ({
  placesList: {
    marginRight: theme.spacing(2),
    minWidth: "150px",
  },
  placeItem: {
    marginBottom: theme.spacing(0.2),
    cursor: "pointer",
    textAlign: "left",
  },
  placeLink: {
    textDecoration: "none",
    color: "#FFF",
    fontSize: "12px",
  },
}));

export default function PlacesList() {
  const classes = useStyles();
  const { placeId } = useParams();
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    const fetchPlaces = async () => {
      try {
        let url = "https://api.bannergress.com/places?used=true";
        if (placeId) {
          url += `&parentPlaceId=${placeId}`;
        } else {
          url += "&type=country";
        }

        console.log(url); // Log the URL of the fetch request

        const response = await fetch(url);
        const data = await response.json();
        console.log(data); // Log the data received from the API
        setPlaces(data);
      } catch (error) {
        console.error(error);
      }
    };

    fetchPlaces();
  }, [placeId]);

  const handleClick = (placeId) => {
    // Handle the click event here
  };

  return (
    <div className={classes.placesList}>
      {places.map((place) => (
        <div
          key={place.id}
          className={classes.placeItem}
          onClick={() => handleClick(place.id)}
        >
          <Link to={`/browse/${place.id}`} className={classes.placeLink}>
            {flags[place.formattedAddress]} {place.formattedAddress} (
            {place.numberOfBanners})
          </Link>
        </div>
      ))}
    </div>
  );
}
