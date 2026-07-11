import { useId } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import {
  BANNER_TOGETHER_COMPARISON_STATUS_OPTIONS,
  findBannerTogetherComparisonPresetId,
  getBannerTogetherComparisonPresetClauses,
  getBannerTogetherComparisonPresetOptions,
  getBannerTogetherComparisonRoleLabels,
} from "../bannerTogetherComparison";

const CUSTOM_PRESET_ID = "custom";
const STATUS_COLORS = {
  todo: "#e4aa3a",
  done: "#69b77b",
  hidden: "#d47777",
  unlisted: "#8fa3b5",
};

function getSelectedPresetId(clauses) {
  try {
    return findBannerTogetherComparisonPresetId(clauses) ?? CUSTOM_PRESET_ID;
  } catch {
    return CUSTOM_PRESET_ID;
  }
}

function orderSelectedStatuses(statuses) {
  return BANNER_TOGETHER_COMPARISON_STATUS_OPTIONS.filter((option) =>
    statuses.includes(option.value)
  ).map((option) => option.value);
}

function StatusSelect({ label, value, onChange }) {
  const selectId = useId();
  const labelId = `${selectId}-label`;
  const helperTextId = `${selectId}-helper-text`;
  const selectedStatuses = Array.isArray(value) ? value : [];
  const hasSelection = selectedStatuses.length > 0;

  return (
    <FormControl fullWidth size="small" error={!hasSelection}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        id={selectId}
        labelId={labelId}
        multiple
        value={selectedStatuses}
        label={label}
        onChange={(event) => {
          const nextValue =
            typeof event.target.value === "string"
              ? event.target.value.split(",")
              : event.target.value;

          onChange(orderSelectedStatuses(nextValue));
        }}
        SelectDisplayProps={{
          "aria-describedby": hasSelection ? undefined : helperTextId,
          "aria-invalid": hasSelection ? undefined : "true",
        }}
        renderValue={(selectedStatuses) =>
          BANNER_TOGETHER_COMPARISON_STATUS_OPTIONS.filter((option) =>
            selectedStatuses.includes(option.value)
          )
            .map((option) => option.label)
            .join(", ")
        }
        sx={{ minHeight: 44 }}
      >
        {BANNER_TOGETHER_COMPARISON_STATUS_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            <Checkbox
              checked={selectedStatuses.includes(option.value)}
              size="small"
            />
            <Box
              aria-hidden="true"
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: STATUS_COLORS[option.value],
                mr: 1.25,
                flexShrink: 0,
              }}
            />
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Select>
      {!hasSelection ? (
        <FormHelperText id={helperTextId}>
          Choose at least one status.
        </FormHelperText>
      ) : null}
    </FormControl>
  );
}

export default function BannerTogetherComparisonBuilder({
  viewerRole,
  clauses,
  onChange,
  resultCount = 0,
}) {
  const presetSelectId = useId();
  const presetLabelId = `${presetSelectId}-label`;
  const safeClauses = Array.isArray(clauses) ? clauses : [];
  const roleLabels = getBannerTogetherComparisonRoleLabels(viewerRole);
  const presetOptions = getBannerTogetherComparisonPresetOptions(viewerRole);
  const selectedPresetId = getSelectedPresetId(safeClauses);
  const normalizedResultCount = Number.isFinite(resultCount)
    ? Math.max(0, resultCount)
    : 0;

  const updateClause = (clauseIndex, side, statuses) => {
    onChange(
      safeClauses.map((clause, index) =>
        index === clauseIndex ? { ...clause, [side]: statuses } : clause
      )
    );
  };

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <FormControl
          fullWidth
          size="small"
          sx={{ maxWidth: { sm: 360 }, minWidth: { sm: 260 } }}
        >
          <InputLabel id={presetLabelId}>Comparison</InputLabel>
          <Select
            id={presetSelectId}
            labelId={presetLabelId}
            value={selectedPresetId}
            label="Comparison"
            onChange={(event) => {
              if (event.target.value !== CUSTOM_PRESET_ID) {
                onChange(
                  getBannerTogetherComparisonPresetClauses(event.target.value)
                );
              }
            }}
            sx={{ minHeight: 44 }}
          >
            {presetOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.label}
              </MenuItem>
            ))}
            <MenuItem value={CUSTOM_PRESET_ID} disabled>
              Custom
            </MenuItem>
          </Select>
        </FormControl>
        <Chip
          label={`${normalizedResultCount} ${
            normalizedResultCount === 1 ? "banner" : "banners"
          }`}
          color="primary"
          sx={{
            borderRadius: 1,
            alignSelf: { xs: "flex-start", sm: "center" },
          }}
        />
      </Stack>

      {safeClauses.length === 0 ? (
        <Typography role="alert" variant="body2" color="error" sx={{ mb: 1.5 }}>
          Choose at least one comparison alternative.
        </Typography>
      ) : null}

      <Stack
        spacing={1.5}
        divider={
          <Divider flexItem>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 700 }}
            >
              OR
            </Typography>
          </Divider>
        }
      >
        {safeClauses.map((clause, clauseIndex) => (
          <Box
            key={`comparison-clause-${clauseIndex}`}
            role="group"
            aria-label={`Comparison alternative ${clauseIndex + 1}`}
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                sm: "minmax(0, 1fr) auto minmax(0, 1fr) 44px",
              },
              gap: 1.25,
              alignItems: "center",
              pt: clauseIndex === 0 ? 0 : 1.5,
            }}
          >
            <StatusSelect
              label={roleLabels.creator}
              value={clause.creator}
              onChange={(statuses) =>
                updateClause(clauseIndex, "creator", statuses)
              }
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: "center", fontWeight: 700 }}
            >
              AND
            </Typography>
            <StatusSelect
              label={roleLabels.recipient}
              value={clause.recipient}
              onChange={(statuses) =>
                updateClause(clauseIndex, "recipient", statuses)
              }
            />
            <Tooltip title="Remove alternative">
              <Box
                component="span"
                sx={{
                  display: "inline-flex",
                  justifySelf: { xs: "end", sm: "auto" },
                }}
              >
                <IconButton
                  aria-label={`Remove comparison alternative ${clauseIndex + 1}`}
                  disabled={safeClauses.length === 1}
                  onClick={() =>
                    onChange(
                      safeClauses.filter(
                        (_clause, index) => index !== clauseIndex
                      )
                    )
                  }
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1,
                  }}
                >
                  <DeleteOutlineRoundedIcon />
                </IconButton>
              </Box>
            </Tooltip>
          </Box>
        ))}
      </Stack>

      <Button
        variant="outlined"
        startIcon={<AddRoundedIcon />}
        onClick={() =>
          onChange([
            ...safeClauses,
            { creator: ["todo"], recipient: ["unlisted"] },
          ])
        }
        sx={{ minHeight: 44, mt: 2, width: { xs: "100%", sm: "auto" } }}
      >
        Add alternative
      </Button>
    </Box>
  );
}
