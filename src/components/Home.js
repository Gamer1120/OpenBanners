import React from "react";
import { AppBar, Toolbar, Typography, Button, Container } from "@mui/material";
import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
  },
  appBar: {
    backgroundColor: theme.palette.background.default,
  },
  menuButton: {
    marginRight: theme.spacing(2),
  },
  title: {
    flexGrow: 1,
  },
  section: {
    marginTop: theme.spacing(2),
  },
}));

export default function Home() {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <AppBar position="static" className={classes.appBar}>
        <Toolbar>
          <Typography variant="h6" className={classes.title}>
            OpenBanners
          </Typography>
          <Button color="inherit">Browse</Button>
          <Button color="inherit">Map</Button>
        </Toolbar>
      </AppBar>
      <Container className={classes.section}>
        <Typography variant="h5">Banners near me</Typography>
      </Container>
    </div>
  );
}
