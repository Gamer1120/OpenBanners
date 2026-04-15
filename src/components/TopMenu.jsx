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
    <AppBar position="static" sx={{ bgcolor: "#121212" }}>
      <Toolbar
        sx={{
          px: { xs: 1.5, sm: "0 !important" },
          py: { xs: 1, sm: 0 },
          display: "flex",
          flexWrap: { xs: "wrap", sm: "nowrap" },
          gap: { xs: 1, sm: 0 },
        }}
      >
        <Container
          sx={{
            width: { xs: "100%", sm: "25% !important" },
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
              borderRadius: 1,
              px: 1,
              py: 0.5,
            }}
          >
            <Typography variant="h6" component="span">
              OB
            </Typography>
          </ButtonBase>
        </Container>

        <Container
          sx={{
            display: "flex",
            flexDirection: { xs: "row", sm: "column" },
            alignItems: "center",
            justifyContent: "center",
            width: { xs: "100%", sm: "5%" },
            pl: "0 !important",
            pr: "0 !important",
            gap: { xs: 1, sm: 0 },
          }}
        >
          <Button
            color="inherit"
            startIcon={<Explore />}
            disableElevation
            onClick={onBrowseClick}
            sx={{
              minHeight: 44,
              width: { xs: "auto", sm: "100%" },
            }}
          >
            Browse
          </Button>
          <Button
            color="inherit"
            startIcon={<LocationOn />}
            disableElevation
            onClick={handleMapClick}
            sx={{
              minHeight: 44,
              width: { xs: "auto", sm: "100%" },
            }}
          >
            Map
          </Button>
        </Container>

        <Container
          sx={{
            display: "flex",
            justifyContent: { xs: "stretch", sm: "flex-end" },
            width: { xs: "100%", sm: "25%" },
            pl: "0 !important",
            pr: "0 !important",
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
              placeholder="Search"
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
