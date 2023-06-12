import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import { Link } from "react-router-dom";
import flags from "./CountryFlags";

const useStyles = makeStyles((theme) => ({
  countryList: {
    marginRight: theme.spacing(2),
    minWidth: "150px",
  },
  countryItem: {
    marginBottom: theme.spacing(0.2),
    cursor: "pointer",
    textAlign: "left",
  },
  countryLink: {
    textDecoration: "none",
    color: "#FFF",
    fontSize: "12px",
  },
}));

export default function CountryList({ onCountryClick }) {
  const classes = useStyles();
  const [countries, setCountries] = useState([]);

  useEffect(() => {
    fetch("https://api.bannergress.com/places?used=true&type=country")
      .then((response) => response.json())
      .then((data) => setCountries(data))
      .catch((error) => console.error(error));
  }, []);

  const handleClick = (countryId) => {
    onCountryClick(countryId);
  };

  return (
    <div className={classes.countryList}>
      {countries.map((country) => (
        <div
          key={country.id}
          className={classes.countryItem}
          onClick={() => handleClick(country.id)}
        >
          <Link to={`/browse/${country.id}`} className={classes.countryLink}>
            {flags[country.formattedAddress]} {country.formattedAddress} (
            {country.numberOfBanners})
          </Link>
        </div>
      ))}
    </div>
  );
}
