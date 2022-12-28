import React from "react";
import { Popup, Marker } from "react-leaflet";

export default function MissionStepMarker(props) {
  return (
    <div>
      <Marker position={[props.latitude, props.longitude]}>
        <Popup>
          A pretty CSS3 popup. <br /> Easily customizable.
        </Popup>
      </Marker>
    </div>
  );
}
