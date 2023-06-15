import React from "react";
import { Button } from "@mui/material";
import { ArrowDropDown, ArrowDropUp } from "@mui/icons-material";

export default function SortingButtons({
  handleSort,
  sortOption,
  sortOrder,
  bannerCount,
}) {
  const showMissionsPerKmButton = bannerCount > 0 && bannerCount < 100;

  return (
    <div>
      <Button
        variant="outlined"
        onClick={() => handleSort("Created")}
        endIcon={
          sortOption === "Created" ? (
            sortOrder === "ASC" ? (
              <ArrowDropUp />
            ) : (
              <ArrowDropDown />
            )
          ) : null
        }
      >
        Created
      </Button>
      <Button
        variant="outlined"
        onClick={() => handleSort("A-Z")}
        endIcon={
          sortOption === "A-Z" ? (
            sortOrder === "ASC" ? (
              <ArrowDropUp />
            ) : (
              <ArrowDropDown />
            )
          ) : null
        }
      >
        A-Z
      </Button>
      <Button
        variant="outlined"
        onClick={() => handleSort("Distance")}
        endIcon={
          sortOption === "Distance" ? (
            sortOrder === "ASC" ? (
              <ArrowDropUp />
            ) : (
              <ArrowDropDown />
            )
          ) : null
        }
      >
        Distance
      </Button>
      <Button
        variant="outlined"
        onClick={() => handleSort("Nr. of Missions")}
        endIcon={
          sortOption === "Nr. of Missions" ? (
            sortOrder === "ASC" ? (
              <ArrowDropUp />
            ) : (
              <ArrowDropDown />
            )
          ) : null
        }
      >
        Nr. of Missions
      </Button>
      <Button
        variant="outlined"
        onClick={() => handleSort("MissionsPerKm")}
        endIcon={
          sortOption === "MissionsPerKm" ? (
            sortOrder === "ASC" ? (
              <ArrowDropUp />
            ) : (
              <ArrowDropDown />
            )
          ) : null
        }
      >
        Missions per km
      </Button>
    </div>
  );
}
