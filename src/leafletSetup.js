// Our Leaflet patches (wheel zoom steps, presses during a zoom animation).
// Imported by every module that draws a map, instead of src/index.jsx, so
// pages without a map don't download Leaflet (it comes in the lazy map
// chunks). leaflet.css stays in index.jsx to keep the stylesheet order.
import "./mapWheelZoom";
import "./mapZoomPress";
