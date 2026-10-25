import React, { useState } from "react";
import { Box, Button, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { ArrowDownward, ArrowUpward, Sort } from "@mui/icons-material";
import { t, tk } from "../i18n";
import BannerFilterButton from "./BannerFilterButton";

const SORT_LABELS = {
  Relevance: { DESC: tk("Best match"), ASC: tk("Best match") },
  Created: { DESC: tk("Newest first"), ASC: tk("Oldest first") },
  "A-Z": { DESC: tk("Z–A"), ASC: tk("A–Z") },
  Distance: { DESC: tk("Longest first"), ASC: tk("Shortest first") },
  "Nr. of Missions": { DESC: tk("Most missions"), ASC: tk("Fewest missions") },
  Efficiency: { DESC: tk("Most missions per km"), ASC: tk("Fewest missions per km") },
};
// Menu labels of the sort options (the option names are what the API gets).
const OPTION_LABELS = {
  Relevance: tk("Best match"),
  Created: tk("Created"),
  "A-Z": tk("A-Z"),
  Distance: tk("Distance"),
  "Nr. of Missions": tk("Nr. of Missions"),
  Efficiency: tk("Efficiency"),
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
  searchQuery,
  bannerFilters,
  onBannerFiltersChange,
  leadingControls = null,
}) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const options = ["Created", "A-Z", "Distance", "Nr. of Missions"];

  if (searchQuery) {
    options.unshift("Relevance");
  }

  if (searchQuery || (placeId && !EFFICIENCY_EXCLUDED_PLACES.has(placeId))) {
    options.push("Efficiency");
  }

  const currentLabel = t(SORT_LABELS[sortOption]?.[sortOrder] ?? OPTION_LABELS[sortOption] ?? sortOption);

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
      {leadingControls}
      <Button
        variant="outlined"
        size="small"
        startIcon={<Sort />}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuAnchor)}
        aria-label={t("Sort: {order}", { order: currentLabel })}
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
                {active && option !== "Relevance" ? (
                  sortOrder === "ASC" ? (
                    <ArrowUpward fontSize="small" />
                  ) : (
                    <ArrowDownward fontSize="small" />
                  )
                ) : null}
              </ListItemIcon>
              <ListItemText>{t(OPTION_LABELS[option] ?? option)}</ListItemText>
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
