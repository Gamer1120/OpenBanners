import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Menu,
  Typography,
} from "@mui/material";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import {
  DEFAULT_BANNER_FILTERS,
  countActiveBannerFilters,
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

export default function BannerFilterButton({
  filters = DEFAULT_BANNER_FILTERS,
  onChange,
  variant = "outlined",
  color = "inherit",
  size = "small",
  sx,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const activeFilterCount = useMemo(
    () => countActiveBannerFilters(filters),
    [filters]
  );
  const hasExclusiveFilterEnabled = MUTUALLY_EXCLUSIVE_FILTER_KEYS.some(
    (key) => Boolean(filters?.[key])
  );

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
        <Box sx={{ px: 2, py: 1.5, minWidth: 260 }}>
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
        </Box>
      </Menu>
    </>
  );
}
