import React, { useState } from "react";
import {
  AppBar,
  Box,
  Container,
  Toolbar,
  Typography,
  Button,
  TextField,
  IconButton,
  InputAdornment,
  ButtonBase,
} from "@mui/material";
import { Explore, LocationOn, Search } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";

export default function TopMenu({ onBrowseClick, onTitleClick, onSearch }) {
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const handleSearch = (event) => {
    event.preventDefault();
    if (searchQuery.trim() === "") {
      return;
    }
    onSearch(searchQuery);
  };

  const handleMapClick = () => {
    navigate("/map");
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: "rgba(11, 16, 20, 0.9)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        backgroundImage: "none",
      }}
    >
      <Toolbar
        sx={{
          px: { xs: 1.5, sm: 2.5 },
          py: { xs: 1.25, sm: 1.5 },
          display: "flex",
          flexWrap: { xs: "wrap", sm: "nowrap" },
          gap: { xs: 1.25, sm: 2 },
          alignItems: "center",
        }}
      >
        <Container
          sx={{
            width: { xs: "100%", sm: "25%" },
            pl: "0 !important",
            pr: "0 !important",
            display: "flex",
            justifyContent: { xs: "center", sm: "flex-start" },
          }}
        >
          <ButtonBase
            onClick={onTitleClick}
            aria-label="Go to home page"
            sx={{
              borderRadius: 1.5,
              px: 1.25,
              py: 0.75,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <Typography
              variant="h6"
              component="span"
              sx={{
                color: "text.primary",
                letterSpacing: "0.08em",
              }}
            >
              OPENBANNERS
            </Typography>
          </ButtonBase>
        </Container>

        <Container
          sx={{
            display: "flex",
            flexDirection: { xs: "row", sm: "row" },
            alignItems: "center",
            justifyContent: "center",
            width: { xs: "100%", sm: "auto" },
            pl: "0 !important",
            pr: "0 !important",
            gap: 1,
          }}
        >
          <Button
            color="inherit"
            startIcon={<Explore />}
            onClick={onBrowseClick}
            sx={{
              minHeight: 44,
              px: 1.75,
              bgcolor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Browse
          </Button>
          <Button
            color="inherit"
            startIcon={<LocationOn />}
            onClick={handleMapClick}
            sx={{
              minHeight: 44,
              px: 1.75,
              bgcolor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Map
          </Button>
        </Container>

        <Container
          sx={{
            display: "flex",
            justifyContent: { xs: "stretch", sm: "flex-end" },
            width: { xs: "100%", sm: "min(360px, 30vw)" },
            pl: "0 !important",
            pr: "0 !important",
            ml: { sm: "auto" },
          }}
        >
          <Box
            component="form"
            onSubmit={handleSearch}
            role="search"
            aria-label="Search banners and places"
            sx={{ width: "100%" }}
          >
            <TextField
              variant="outlined"
              placeholder="Search banners or places"
              size="small"
              fullWidth
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              inputProps={{ "aria-label": "Search query" }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton type="submit" aria-label="Submit search">
                      <Search />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </Container>
      </Toolbar>
    </AppBar>
  );
}
