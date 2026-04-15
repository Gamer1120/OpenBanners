import React from "react";
import { Box, Button } from "@mui/material";
import { ArrowDropDown, ArrowDropUp } from "@mui/icons-material";
import BannerFilterButton from "./BannerFilterButton";

export default function SortingButtons({
  handleSort,
  sortOption,
  sortOrder,
  placeId,
  bannerFilters,
  onBannerFiltersChange,
}) {
  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <BannerFilterButton
        filters={bannerFilters}
        onChange={onBannerFiltersChange}
      />
      <Button
        variant="outlined"
        size="small"
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
        size="small"
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
        size="small"
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
        size="small"
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
      {placeId &&
        placeId !== "united-states-3d4e" &&
        placeId !== "japan-8068" &&
        placeId !== "germany-ea85" && (
          <Button
            variant="outlined"
            size="small"
            onClick={() => handleSort("Efficiency")}
            endIcon={
              sortOption === "Efficiency" ? (
                sortOrder === "ASC" ? (
                  <ArrowDropUp />
                ) : (
                  <ArrowDropDown />
                )
              ) : null
            }
          >
            Efficiency
          </Button>
        )}
    </Box>
  );
}
