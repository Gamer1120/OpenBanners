import React, { useEffect, useRef } from "react";
import MissionStepMarker from "./MissionStepMarker";
import { Polyline, useMap, MapContainer } from "react-leaflet";

export default function Mission({ mission, missionNumber, color }) {
  const mapRef = useRef(null);

  const stepsToRender = Object.values(mission.steps).filter(
    (step) => step.poi.type !== "unavailable"
  );

  const polylinePositions = stepsToRender.map((step) => [
    step.poi.latitude,
    step.poi.longitude,
  ]);

  useEffect(() => {
    const map = mapRef.current?.leafletElement;
    if (map) {
      const updatePolylines = () => {
        map.eachLayer((layer) => {
          if (layer instanceof Polyline) {
            layer.redraw(); // Redraw the polylines
          }
        });
      };

      map.on("moveend", updatePolylines); // Update polylines when the map moves

      return () => {
        map.off("moveend", updatePolylines); // Remove the event listener when component unmounts
      };
    }
  }, []);

  return (
    <div>
      {stepsToRender.map((step, index) => (
        <MissionStepMarker
          key={step.poi.title}
          portalName={step.poi.title}
          latitude={step.poi.latitude}
          longitude={step.poi.longitude}
          missionNumber={missionNumber}
          color={color}
          isFirst={index === 0}
        />
      ))}
      <Polyline positions={polylinePositions} color={color} />
      <MapContainer
        ref={mapRef}
        center={[52.221058, 6.893297]}
        zoom={8}
        scrollWheelZoom={true}
        style={{ display: "none" }} // Hide the map container
      />
    </div>
  );
}
