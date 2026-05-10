import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Menu,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ViewModuleRoundedIcon from "@mui/icons-material/ViewModuleRounded";

const VISUAL_CARD_SIZE_PRESETS = {
  compact: 6,
  normal: 5,
  large: 4,
};

export default function VisualCardSizeButton({
  sizeMode,
  customColumns,
  sliderMin,
  sliderMax,
  onSizeModeChange,
  onCustomColumnsChange,
  variant = "outlined",
  color = "inherit",
  size = "small",
  sx,
  labelSx,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const isOpen = Boolean(anchorEl);
  const effectiveColumns =
    sizeMode === "custom"
      ? Math.min(Math.max(customColumns, sliderMin), sliderMax)
      : VISUAL_CARD_SIZE_PRESETS[sizeMode] ?? VISUAL_CARD_SIZE_PRESETS.normal;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (sizeMode === "custom" && customColumns > sliderMax) {
      onCustomColumnsChange?.(sliderMax);
    }
  }, [customColumns, isOpen, onCustomColumnsChange, sizeMode, sliderMax]);

  const buttonLabel = useMemo(() => {
    if (sizeMode === "custom") {
      return `Card size (${effectiveColumns}/row)`;
    }

    return "Card size";
  }, [effectiveColumns, sizeMode]);

  return (
    <>
      <Button
        variant={variant}
        color={color}
        size={size}
        startIcon={<ViewModuleRoundedIcon />}
        aria-label={buttonLabel}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={sx}
      >
        <Box component="span" sx={labelSx}>
          {buttonLabel}
        </Box>
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={isOpen}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Box sx={{ px: 2, py: 1.5, minWidth: 300 }}>
          <Typography
            variant="overline"
            sx={{ color: "text.secondary", letterSpacing: "0.12em" }}
          >
            Visual card size
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={sizeMode}
            onChange={(_, nextMode) => {
              if (!nextMode) {
                return;
              }
              onSizeModeChange?.(nextMode);
            }}
            sx={{ mt: 0.75, display: "flex", flexWrap: "wrap" }}
          >
            <ToggleButton value="compact">Compact</ToggleButton>
            <ToggleButton value="normal">Normal</ToggleButton>
            <ToggleButton value="large">Large</ToggleButton>
            <ToggleButton value="custom">Custom</ToggleButton>
          </ToggleButtonGroup>

          {sizeMode === "custom" ? (
            <Box sx={{ mt: 1.5, px: 0.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                Cards per row
              </Typography>
              <Slider
                value={Math.min(Math.max(customColumns, sliderMin), sliderMax)}
                min={sliderMin}
                max={sliderMax}
                step={1}
                marks
                onChange={(_, nextValue) => {
                  const value = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                  onCustomColumnsChange?.(value);
                }}
                valueLabelDisplay="auto"
                aria-label="Cards per row"
              />
            </Box>
          ) : null}
        </Box>
      </Menu>
    </>
  );
}
