import { useState, useEffect } from "react";
import { L, useMap, MapContainer } from "react-leaflet";

export default function Map() {
  return (
    <MapContainer
      center={[51.505, -0.09]}
      zoom={20}
      style={{ height: "100vh" }}
    ></MapContainer>
  );
}
