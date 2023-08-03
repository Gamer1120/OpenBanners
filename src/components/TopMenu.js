import React, { useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
  TextField,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { makeStyles } from "@mui/styles";
import { Explore, LocationOn, Search } from "@mui/icons-material";
import { Link, useNavigate } from "react-router-dom"; // Import useNavigate

const useStyles = makeStyles((theme) => ({
  appBar: {
    backgroundColor: theme.palette.grey[800],
  },
  menuButton: {
    marginRight: theme.spacing(2),
  },
  titleContainer: {
    display: "flex",
    alignItems: "center",
    width: "33%",
  },
  title: {
    marginLeft: theme.spacing(2),
  },
  buttonContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "33%",
  },
  searchContainer: {
    display: "flex",
    justifyContent: "flex-end",
    width: "33%",
  },
  searchInput: {
    paddingRight: theme.spacing(2),
  },
}));

export default function TopMenu({ onBrowseClick, onTitleClick, onSearch }) {
  const classes = useStyles();
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
    <AppBar position="static" className={classes.appBar}>
      <Toolbar>
        <Container className={classes.titleContainer}>
          <Typography
            variant="h6"
            className={classes.title}
            onClick={onTitleClick}
            style={{ cursor: "pointer" }}
          >
            OpenBanners Alpha
          </Typography>
        </Container>
        <Container className={classes.buttonContainer}>
          <Button
            color="inherit"
            startIcon={<Explore />}
            disableElevation
            component={Link}
            to="/browse/"
          >
            Browse
          </Button>
          <Button
            color="inherit"
            startIcon={<LocationOn />}
            disableElevation
            onClick={handleMapClick} // Add onClick event handler
          >
            Map
          </Button>
        </Container>
        <Container className={classes.searchContainer}>
          <form onSubmit={handleSearch} searchQuery={searchQuery}>
            <TextField
              variant="outlined"
              placeholder="Search"
              size="small"
              className={classes.searchInput}
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
          </form>
        </Container>
      </Toolbar>
    </AppBar>
  );
}
