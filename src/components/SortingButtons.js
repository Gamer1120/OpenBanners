import React from "react";
import { Button } from "@mui/material";
import { ArrowDropDown, ArrowDropUp } from "@mui/icons-material";

export default function SortingButtons({ handleSort, sortOption, sortOrder }) {
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
    </div>
  );
}
