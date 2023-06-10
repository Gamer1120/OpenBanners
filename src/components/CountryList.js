import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  countryList: {
    marginRight: theme.spacing(2),
    minWidth: "150px", // Optional: Adjust the width as needed
  },

  countryItem: {
    marginBottom: theme.spacing(1),
    cursor: "pointer",
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
        <div
          key={country.id}
          className={classes.countryItem}
          onClick={() => console.log(country.formattedAddress)} // Replace with your desired functionality
        >
          {country.formattedAddress}
        </div>
      ))}
    </div>
  );
}
