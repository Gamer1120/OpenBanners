import React, { useState } from "react";
import { Box, Button, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { ArrowDownward, ArrowUpward, Sort } from "@mui/icons-material";
import BannerFilterButton from "./BannerFilterButton";

const SORT_LABELS = {
  Created: { DESC: "Newest first", ASC: "Oldest first" },
  "A-Z": { DESC: "Z–A", ASC: "A–Z" },
  Distance: { DESC: "Longest first", ASC: "Shortest first" },
  "Nr. of Missions": { DESC: "Most missions", ASC: "Fewest missions" },
  Efficiency: { DESC: "Most missions per km", ASC: "Fewest missions per km" },
};
// Efficiency fetches every banner of the place, so it's off for the biggest countries.
const EFFICIENCY_EXCLUDED_PLACES = new Set([
  "united-states-3d4e",
  "japan-8068",
  "germany-ea85",
]);

export default function SortingButtons({
  handleSort,
  sortOption,
  sortOrder,
  placeId,
  bannerFilters,
  onBannerFiltersChange,
  leadingControls = null,
}) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const options = ["Created", "A-Z", "Distance", "Nr. of Missions"];

  if (placeId && !EFFICIENCY_EXCLUDED_PLACES.has(placeId)) {
    options.push("Efficiency");
  }

  const currentLabel = SORT_LABELS[sortOption]?.[sortOrder] ?? sortOption;

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
      {leadingControls}
      <Button
        variant="outlined"
        size="small"
        startIcon={<Sort />}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuAnchor)}
        aria-label={`Sort: ${currentLabel}`}
        onClick={(event) => setMenuAnchor(event.currentTarget)}
      >
        {currentLabel}
      </Button>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        {options.map((option) => {
          const active = option === sortOption;

          return (
            <MenuItem
              key={option}
              selected={active}
              onClick={() => {
                setMenuAnchor(null);
                handleSort(option);
              }}
            >
              <ListItemIcon>
                {active ? (
                  sortOrder === "ASC" ? (
                    <ArrowUpward fontSize="small" />
                  ) : (
                    <ArrowDownward fontSize="small" />
                  )
                ) : null}
              </ListItemIcon>
              <ListItemText>{option}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
      <BannerFilterButton
        filters={bannerFilters}
        onChange={onBannerFiltersChange}
        showMinimumMissionsFilter
      />
    </Box>
  );
}
