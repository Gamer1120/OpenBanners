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
      position="static"
      sx={{
        bgcolor: "#121212",
      }}
    >
      <Toolbar sx={{ px: "0 !important" }}>
        <Container
          sx={{
            width: "25% !important",
            pl: "0 !important",
            pr: "0 !important",
          }}
        >
          <Typography
            variant="h6"
            onClick={onTitleClick}
            sx={{ cursor: "pointer" }}
          >
            OB
          </Typography>
        </Container>

        <Container
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "5%",
            pl: "0 !important",
            pr: "0 !important",
          }}
        >
          <Button
            color="inherit"
            startIcon={<Explore />}
            disableElevation
            onClick={onBrowseClick}
          >
            Browse
          </Button>
          <Button
            color="inherit"
            startIcon={<LocationOn />}
            disableElevation
            onClick={handleMapClick}
          >
            Map
          </Button>
        </Container>

        <Container
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            width: "25%",
          }}
        >
          <Box component="form" onSubmit={handleSearch}>
            <TextField
              variant="outlined"
              placeholder="Search"
              size="small"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton type="submit">
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
