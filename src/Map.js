import { useState, useEffect } from "react";
import {
  L,
  useMap,
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from "react-leaflet";
import LocationMarker from "./LocationMarker";

export default function Map() {
  return (
    <MapContainer
      id="map"
      center={[51.505, -0.09]}
      zoom={13}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[51.505, -0.09]}>
        <Popup>
          A pretty CSS3 popup. <br /> Easily customizable.
        </Popup>
      </Marker>
      <LocationMarker />
    </MapContainer>
  );
}
