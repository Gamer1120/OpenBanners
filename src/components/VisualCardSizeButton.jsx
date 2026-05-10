import { useEffect, useMemo, useState } from "react";
import { Box, Button, Menu, Slider, Typography } from "@mui/material";
import ViewModuleRoundedIcon from "@mui/icons-material/ViewModuleRounded";

export default function VisualCardSizeButton({
  columns,
  sliderMin,
  sliderMax,
  onColumnsChange,
  variant = "outlined",
  color = "inherit",
  size = "small",
  sx,
  labelSx,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const isOpen = Boolean(anchorEl);
  const effectiveColumns = Math.min(Math.max(columns, sliderMin), sliderMax);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (columns > sliderMax) {
      onColumnsChange?.(sliderMax);
    }
  }, [columns, isOpen, onColumnsChange, sliderMax]);

  const buttonLabel = useMemo(() => `Card size (${effectiveColumns}/row)`, [effectiveColumns]);

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
          <Box sx={{ mt: 1.25, px: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
              Cards per row
            </Typography>
            <Slider
              value={Math.min(Math.max(columns, sliderMin), sliderMax)}
              min={sliderMin}
              max={sliderMax}
              step={1}
              marks
              onChange={(_, nextValue) => {
                const value = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                onColumnsChange?.(value);
              }}
              valueLabelDisplay="auto"
              aria-label="Cards per row"
            />
          </Box>
        </Box>
      </Menu>
    </>
  );
}
