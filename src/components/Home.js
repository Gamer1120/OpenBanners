import React, { useEffect, useState } from "react";
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

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.grey[900],
    minHeight: "100vh",
  },
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
  section: {
    marginTop: theme.spacing(2),
    color: theme.palette.common.white,
  },
  permissionText: {
    color: theme.palette.error.main,
  },
}));

export default function Home() {
  const classes = useStyles();
  const [permissionStatus, setPermissionStatus] = useState("unknown");

  useEffect(() => {
    const handlePermission = (status) => {
      setPermissionStatus(status);
      if (status === "granted") {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            console.log("Latitude:", latitude);
            console.log("Longitude:", longitude);
          },
          (error) => {
            console.error("Error getting location:", error);
          }
        );
      }
    };

    if ("permissions" in navigator) {
      navigator.permissions.query({ name: "geolocation" }).then((result) => {
        handlePermission(result.state);
        result.onchange = () => {
          handlePermission(result.state);
        };
      });
    } else if ("geolocation" in navigator) {
      handlePermission("granted");
    } else {
      handlePermission("denied");
    }
  }, []);

  return (
    <div className={classes.root}>
      <AppBar position="static" className={classes.appBar}>
        <Toolbar>
          <Container className={classes.titleContainer}>
            <Typography variant="h6" className={classes.title}>
              OpenBanners
            </Typography>
          </Container>
          <Container className={classes.buttonContainer}>
            <Button color="inherit" startIcon={<Explore />} disableElevation>
              Browse
            </Button>
            <Button color="inherit" startIcon={<LocationOn />} disableElevation>
              Map
            </Button>
          </Container>
          <Container className={classes.searchContainer}>
            <TextField
              variant="outlined"
              placeholder="Search"
              size="small"
              className={classes.searchInput}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton>
                      <Search />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Container>
        </Toolbar>
      </AppBar>
      <Container className={classes.section}>
        <Typography variant="h5">Banners near me</Typography>
        {permissionStatus !== "granted" && (
          <Typography variant="body2" className={classes.permissionText}>
            Location Permission not allowed
          </Typography>
        )}
      </Container>
    </div>
  );
}
