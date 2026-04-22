import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Menu,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import {
  DEFAULT_BANNER_FILTERS,
  countActiveBannerFilters,
  getMissionCountBounds,
  PRESET_MISSION_COUNT_FILTERS,
} from "../bannerFilters";

const filterOptions = [
  {
    key: "showOfflineBanners",
    label: "Show offline banners",
  },
  {
    key: "showHiddenBanners",
    label: "Show hidden banners",
    helperText: "To do and Done markers can't be shown.",
  },
  {
    key: "hideDoneBanners",
    label: "Hide done banners",
    helperText: "Can't be combined with Show hidden banners.",
  },
];

const MUTUALLY_EXCLUSIVE_FILTER_KEYS = [
  "showHiddenBanners",
  "hideDoneBanners",
];

function sanitizeMissionInput(value) {
  return value.replace(/[^0-9]/g, "");
}

export default function BannerFilterButton({
  filters = DEFAULT_BANNER_FILTERS,
  onChange,
  variant = "outlined",
  color = "inherit",
  size = "small",
  sx,
  showMinimumMissionsFilter = false,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const activeFilterCount = useMemo(
    () => countActiveBannerFilters(filters),
    [filters]
  );
  const hasExclusiveFilterEnabled = MUTUALLY_EXCLUSIVE_FILTER_KEYS.some(
    (key) => Boolean(filters?.[key])
  );
  const { minimumMissions } = getMissionCountBounds(filters);
  const presetMinimumMissions = Number(filters?.minimumMissions) || 0;
  const isCustomMissionFilter =
    filters?.missionCountFilterMode === "custom" ||
    !PRESET_MISSION_COUNT_FILTERS.includes(presetMinimumMissions);
  const missionToggleValue = isCustomMissionFilter
    ? "custom"
    : String(minimumMissions);

  return (
    <>
      <Button
        variant={variant}
        color={color}
        size={size}
        startIcon={<FilterListRoundedIcon />}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={sx}
      >
        {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Box sx={{ px: 2, py: 1.5, minWidth: 280 }}>
          <Typography
            variant="overline"
            sx={{ color: "text.secondary", letterSpacing: "0.12em" }}
          >
            Banner Filters
          </Typography>
          <FormGroup sx={{ mt: 0.5 }}>
            {filterOptions.map((option) => {
              const isChecked = Boolean(filters?.[option.key]);

              return (
                <Box key={option.key}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={isChecked}
                        disabled={
                          MUTUALLY_EXCLUSIVE_FILTER_KEYS.includes(option.key) &&
                          !isChecked &&
                          hasExclusiveFilterEnabled
                        }
                        onChange={(event) => {
                          const nextFilters = {
                            ...filters,
                            [option.key]: event.target.checked,
                          };

                          if (
                            event.target.checked &&
                            option.key === "showHiddenBanners"
                          ) {
                            nextFilters.hideDoneBanners = false;
                          }

                          if (
                            event.target.checked &&
                            option.key === "hideDoneBanners"
                          ) {
                            nextFilters.showHiddenBanners = false;
                          }

                          onChange?.(nextFilters);
                        }}
                      />
                    }
                    label={option.label}
                  />
                  {isChecked && option.helperText ? (
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        ml: 4.5,
                        mt: -0.25,
                        mb: 0.5,
                        color: "text.secondary",
                        maxWidth: 220,
                      }}
                    >
                      {option.helperText}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </FormGroup>

          {showMinimumMissionsFilter ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography
                variant="overline"
                sx={{ color: "text.secondary", letterSpacing: "0.12em" }}
              >
                Banner length
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={missionToggleValue}
                onChange={(_, nextValue) => {
                  if (nextValue === null) {
                    return;
                  }

                  if (nextValue === "custom") {
                    onChange?.({
                      ...filters,
                      missionCountFilterMode: "custom",
                    });
                    return;
                  }

                  onChange?.({
                    ...filters,
                    missionCountFilterMode: "preset",
                    minimumMissions: Number(nextValue),
                  });
                }}
                sx={{ mt: 0.75, display: "flex", flexWrap: "wrap" }}
              >
                <ToggleButton value="0">Any</ToggleButton>
                <ToggleButton value="6">6+</ToggleButton>
                <ToggleButton value="12">12+</ToggleButton>
                <ToggleButton value="18">18+</ToggleButton>
                <ToggleButton value="custom">Custom</ToggleButton>
              </ToggleButtonGroup>

              {isCustomMissionFilter ? (
                <>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                    <TextField
                      label="Minimum"
                      size="small"
                      type="number"
                      value={filters?.customMinimumMissions ?? ""}
                      onChange={(event) => {
                        onChange?.({
                          ...filters,
                          missionCountFilterMode: "custom",
                          customMinimumMissions: sanitizeMissionInput(
                            event.target.value
                          ),
                        });
                      }}
                      inputProps={{ min: 0, inputMode: "numeric" }}
                      sx={{ width: 120 }}
                    />
                    <TextField
                      label="Maximum"
                      size="small"
                      type="number"
                      value={filters?.customMaximumMissions ?? ""}
                      onChange={(event) => {
                        onChange?.({
                          ...filters,
                          missionCountFilterMode: "custom",
                          customMaximumMissions: sanitizeMissionInput(
                            event.target.value
                          ),
                        });
                      }}
                      inputProps={{ min: 0, inputMode: "numeric" }}
                      sx={{ width: 120 }}
                    />
                  </Stack>
                  <Typography
                    variant="caption"
                    sx={{ display: "block", mt: 0.75, color: "text.secondary" }}
                  >
                    Leave a field empty to remove that limit.
                  </Typography>
                </>
              ) : null}
            </Box>
          ) : null}
        </Box>
      </Menu>
    </>
  );
}
