import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import { Link } from "react-router-dom";
import flags from "./CountryFlags";

const useStyles = makeStyles((theme) => ({
  countryList: {
    marginRight: theme.spacing(2),
    minWidth: "150px", // Optional: Adjust the width as needed
  },
  countryItem: {
    marginBottom: theme.spacing(0.2), // Adjust the spacing as desired
    cursor: "pointer",
    textAlign: "left", // Align the country names to the left
  },
  countryLink: {
    textDecoration: "none",
    color: "#FFF",
    fontSize: "12px",
  },
}));

export default function CountryList() {
  const classes = useStyles();
  const [countries, setCountries] = useState([]);

  useEffect(() => {
    fetch("https://api.bannergress.com/places?used=true&type=country")
      .then((response) => response.json())
      .then((data) => setCountries(data))
      .catch((error) => console.error(error));
  }, []);

  return (
    <div className={classes.countryList}>
      {countries.map((country) => (
        <div key={country.id} className={classes.countryItem}>
          <Link to={`/browse/${country.id}`} className={classes.countryLink}>
            {flags[country.formattedAddress]} {country.formattedAddress} (
            {country.numberOfBanners})
          </Link>
        </div>
      ))}
    </div>
  );
}
