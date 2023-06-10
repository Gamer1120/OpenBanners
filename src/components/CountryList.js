import React, { useState, useEffect } from "react";
import { makeStyles } from "@mui/styles";
import { Link } from "react-router-dom";

var flags = {
  "United States": "🇺🇸",
  Japan: "🇯🇵",
  Germany: "🇩🇪",
  Spain: "🇪🇸",
  "United Kingdom": "🇬🇧",
  Brazil: "🇧🇷",
  China: "🇨🇳",
  France: "🇫🇷",
  Netherlands: "🇳🇱",
  Russia: "🇷🇺",
  Italy: "🇮🇹",
  Peru: "🇵🇪",
  Poland: "🇵🇱",
  Indonesia: "🇮🇩",
  Chile: "🇨🇱",
  Belgium: "🇧🇪",
  Australia: "🇦🇺",
  Taiwan: "🇹🇼",
  Sweden: "🇸🇪",
  Finland: "🇫🇮",
  Portugal: "🇵🇹",
  "South Korea": "🇰🇷",
  Ukraine: "🇺🇦",
  Canada: "🇨🇦",
  Philippines: "🇵🇭",
  Czechia: "🇨🇿",
  Switzerland: "🇨🇭",
  Norway: "🇳🇴",
  Austria: "🇦🇹",
  India: "🇮🇳",
  Mexico: "🇲🇽",
  Argentina: "🇦🇷",
  Denmark: "🇩🇰",
  Malaysia: "🇲🇾",
  Hungary: "🇭🇺",
  Ecuador: "🇪🇨",
  Lithuania: "🇱🇹",
  Colombia: "🇨🇴",
  "New Zealand": "🇳🇿",
  "South Africa": "🇿🇦",
  Estonia: "🇪🇪",
  "Hong Kong": "🇭🇰",
  Belarus: "🇧🇾",
  Bolivia: "🇧🇴",
  Thailand: "🇹🇭",
  Greece: "🇬🇷",
  Singapore: "🇸🇬",
  "Sri Lanka": "🇱🇰",
  Turkey: "🇹🇷",
  Slovakia: "🇸🇰",
  Romania: "🇷🇴",
  Croatia: "🇭🇷",
  Latvia: "🇱🇻",
  Ireland: "🇮🇪",
  "El Salvador": "🇸🇻",
  Honduras: "🇭🇳",
  Bulgaria: "🇧🇬",
  Uruguay: "🇺🇾",
  Paraguay: "🇵🇾",
  Slovenia: "🇸🇮",
  "United Arab Emirates": "🇦🇪",
  Kazakhstan: "🇰🇿",
  Maldives: "🇲🇻",
  Panama: "🇵🇦",
  Bangladesh: "🇧🇩",
  Macao: "🇲🇴",
  "Dominican Republic": "🇩🇴",
  Serbia: "🇷🇸",
  Vietnam: "🇻🇳",
  "Costa Rica": "🇨🇷",
  Israel: "🇮🇱",
  Venezuela: "🇻🇪",
  Luxembourg: "🇱🇺",
  Guatemala: "🇬🇹",
  Iceland: "🇮🇸",
  Gibraltar: "🇬🇮",
  Georgia: "🇬🇪",
  Uzbekistan: "🇺🇿",
  Andorra: "🇦🇩",
  "North Macedonia": "🇲🇰",
  Cyprus: "🇨🇾",
  Moldova: "🇲🇩",
  "Myanmar (Burma)": "🇲🇲",
  Morocco: "🇲🇦",
  Qatar: "🇶🇦",
  Egypt: "🇪🇬",
  "French Polynesia": "🇵🇫",
  Armenia: "🇦🇲",
  Lebanon: "🇱🇧",
  "New Caledonia": "🇳🇨",
  Malta: "🇲🇹",
  Nicaragua: "🇳🇮",
  "Bosnia and Herzegovina": "🇧🇦",
  Réunion: "🇷🇪",
  Kenya: "🇰🇪",
  "Puerto Rico": "🇵🇷",
  Cambodia: "🇰🇭",
  Montenegro: "🇲🇪",
  Jersey: "🇯🇪",
  Mauritius: "🇲🇺",
  Nepal: "🇳🇵",
  Tunisia: "🇹🇳",
  Greenland: "🇬🇱",
  Guadeloupe: "🇬🇵",
  Fiji: "🇫🇯",
  Aruba: "🇦🇼",
  "Cayman Islands": "🇰🇾",
  "North Korea": "🇰🇵",
  Curaçao: "🇨🇼",
  Azerbaijan: "🇦🇿",
  "Trinidad and Tobago": "🇹🇹",
  Brunei: "🇧🇳",
  Seychelles: "🇸🇨",
  Kuwait: "🇰🇼",
  Albania: "🇦🇱",
  Rwanda: "🇷🇼",
  "The Bahamas": "🇧🇸",
  "Åland Islands": "🇦🇽",
  "Faroe Islands": "🇫🇴",
  Barbados: "🇧🇧",
  Suriname: "🇸🇷",
  Jamaica: "🇯🇲",
  Martinique: "🇲🇶",
  Zambia: "🇿🇲",
  Monaco: "🇲🇨",
  Bahrain: "🇧🇭",
  "Saudi Arabia": "🇸🇦",
  Antarctica: "🇦🇶",
  Namibia: "🇳🇦",
  Cuba: "🇨🇺",
  Mayotte: "🇾🇹",
  "Svalbard and Jan Mayen": "🇸🇯",
  Mongolia: "🇲🇳",
  Kyrgyzstan: "🇰🇬",
  "Cook Islands": "🇨🇰",
  Jordan: "🇯🇴",
  "U.S. Virgin Islands": "🇻🇮",
  "St Lucia": "🇱🇨",
  "Northern Mariana Islands": "🇲🇵",
  "San Marino": "🇸🇲",
  Laos: "🇱🇦",
  Sudan: "🇸🇩",
  Oman: "🇴🇲",
  Nauru: "🇳🇷",
  Guernsey: "🇬🇬",
  "Isle of Man": "🇮🇲",
  Guam: "🇬🇺",
  Benin: "🇧🇯",
  Zimbabwe: "🇿🇼",
  Botswana: "🇧🇼",
};

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
