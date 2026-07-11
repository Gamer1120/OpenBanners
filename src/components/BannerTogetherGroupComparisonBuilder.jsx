import { Fragment, useId, useMemo } from "react";
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
  BANNER_TOGETHER_GROUP_PRESET_IDS,
  BANNER_TOGETHER_GROUP_STATUS_OPTIONS,
  findBannerTogetherGroupPresetId,
  getBannerTogetherGroupPresetClauses,
  getBannerTogetherGroupPresetOptions,
  normalizeBannerTogetherGroupParticipantIdentities,
} from "../bannerTogetherGroupComparison";

const CUSTOM_PRESET_ID = "custom";
const STATUS_COLORS = {
  todo: "#e4aa3a",
  done: "#69b77b",
  hidden: "#d47777",
  unlisted: "#8fa3b5",
};

function orderSelectedStatuses(statuses) {
  return BANNER_TOGETHER_GROUP_STATUS_OPTIONS.filter((option) =>
    statuses.includes(option.value)
  ).map((option) => option.value);
}

function getSelectedPresetId(participants, localParticipantId, clauses) {
  try {
    return (
      findBannerTogetherGroupPresetId({
        participants,
        localParticipantId,
        clauses,
      }) ?? CUSTOM_PRESET_ID
    );
  } catch {
    return CUSTOM_PRESET_ID;
  }
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
        renderValue={(selected) =>
          BANNER_TOGETHER_GROUP_STATUS_OPTIONS.filter((option) =>
            selected.includes(option.value)
          )
            .map((option) => option.label)
            .join(", ")
        }
        sx={{ minHeight: 44 }}
      >
        {BANNER_TOGETHER_GROUP_STATUS_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            value={option.value}
            sx={{ minHeight: 44 }}
          >
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

export default function BannerTogetherGroupComparisonBuilder({
  participants,
  localParticipantId,
  clauses,
  onChange,
  resultCount = 0,
}) {
  const presetSelectId = useId();
  const presetLabelId = `${presetSelectId}-label`;
  const normalizedParticipants = useMemo(
    () => normalizeBannerTogetherGroupParticipantIdentities(participants),
    [participants]
  );
  const safeClauses = Array.isArray(clauses) ? clauses : [];
  const presetOptions = getBannerTogetherGroupPresetOptions(
    normalizedParticipants,
    localParticipantId
  );
  const selectedPresetId = getSelectedPresetId(
    normalizedParticipants,
    localParticipantId,
    safeClauses
  );
  const normalizedResultCount = Number.isFinite(resultCount)
    ? Math.max(0, resultCount)
    : 0;

  const updateParticipantStatuses = (
    clauseIndex,
    participantId,
    statuses
  ) => {
    onChange(
      safeClauses.map((clause, index) =>
        index === clauseIndex
          ? {
              ...clause,
              participantStatuses: {
                ...clause.participantStatuses,
                [participantId]: statuses,
              },
            }
          : clause
      )
    );
  };

  const getParticipantLabel = (participant) =>
    participant.id === localParticipantId
      ? `${participant.label} (you)`
      : participant.label;

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
          sx={{ maxWidth: { sm: 420 }, minWidth: { sm: 300 } }}
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
                  getBannerTogetherGroupPresetClauses(
                    event.target.value,
                    normalizedParticipants,
                    localParticipantId
                  )
                );
              }
            }}
            sx={{ minHeight: 44 }}
          >
            {presetOptions.map((option) => (
              <MenuItem key={option.id} value={option.id} sx={{ minHeight: 44 }}>
                {option.label}
              </MenuItem>
            ))}
            <MenuItem value={CUSTOM_PRESET_ID} disabled sx={{ minHeight: 44 }}>
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
            key={`group-comparison-clause-${clauseIndex}`}
            role="group"
            aria-label={`Comparison alternative ${clauseIndex + 1}`}
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: { xs: 1.5, sm: 2 },
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 1.5 }}
            >
              <Typography variant="subtitle2">
                Alternative {clauseIndex + 1}
              </Typography>
              <Tooltip title="Remove alternative">
                <Box component="span" sx={{ display: "inline-flex" }}>
                  <IconButton
                    aria-label={`Remove comparison alternative ${
                      clauseIndex + 1
                    }`}
                    disabled={safeClauses.length === 1}
                    onClick={() =>
                      onChange(
                        safeClauses.filter(
                          (_clause, index) => index !== clauseIndex
                        )
                      )
                    }
                    sx={{ width: 44, height: 44, borderRadius: 1 }}
                  >
                    <DeleteOutlineRoundedIcon />
                  </IconButton>
                </Box>
              </Tooltip>
            </Stack>

            <Stack spacing={1}>
              {normalizedParticipants.map((participant, participantIndex) => (
                <Fragment key={participant.id}>
                  {participantIndex > 0 ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ alignSelf: "center", fontWeight: 700 }}
                    >
                      AND
                    </Typography>
                  ) : null}
                  <StatusSelect
                    label={getParticipantLabel(participant)}
                    value={clause.participantStatuses?.[participant.id]}
                    onChange={(statuses) =>
                      updateParticipantStatuses(
                        clauseIndex,
                        participant.id,
                        statuses
                      )
                    }
                  />
                </Fragment>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>

      <Button
        variant="outlined"
        startIcon={<AddRoundedIcon />}
        onClick={() =>
          onChange([
            ...safeClauses,
            getBannerTogetherGroupPresetClauses(
              BANNER_TOGETHER_GROUP_PRESET_IDS.MY_TODO_OTHERS_UNLISTED,
              normalizedParticipants,
              localParticipantId
            )[0],
          ])
        }
        sx={{ minHeight: 44, mt: 2, width: { xs: "100%", sm: "auto" } }}
      >
        Add alternative
      </Button>
    </Box>
  );
}
