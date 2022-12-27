import { Popup, Marker, useMap } from "react-leaflet";
import React from "react";
import "leaflet-easybutton/src/easy-button.js";
import "leaflet-easybutton/src/easy-button.css";
import "font-awesome/css/font-awesome.min.css";
import L from "leaflet";

class LocationMarker extends React.Component {
  constructor(props) {
    super(props);
    this.state = { position: null };
  }

  componentDidMount() {
    const map = useMap();
    L.easyButton("fa-map-marker", () => {
      map.locate().on("locationfound", function (e) {
        this.setState({ position: e.latlng });
        map.flyTo(e.latlng, map.getZoom());
      });
    }).addTo(map);
  }

  render() {
    return this.state.position === null ? null : (
      <Marker position={this.state.position}>
        <Popup>You are here</Popup>
      </Marker>
    );
  }
}

export default LocationMarker;
