import React from "react";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";

export default function BannerResultsViewToggle({ viewMode, onChange }) {
  const handleChange = (_, nextViewMode) => {
    if (nextViewMode) {
      onChange(nextViewMode);
    }
  };

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={viewMode}
      onChange={handleChange}
      aria-label="Banner view mode"
      sx={{
        flexWrap: "wrap",
        "& .MuiToggleButton-root": {
          px: 1.4,
          textTransform: "none",
        },
      }}
    >
      <ToggleButton value="visual" aria-label="Visual banner view">
        Visual
      </ToggleButton>
      <ToggleButton value="compact" aria-label="Compact banner view">
        Compact
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
