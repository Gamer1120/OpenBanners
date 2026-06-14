export const MISSION_CONTROLS_OVERLAY_SELECTOR =
  '[data-map-overlay="mission-controls"]';

const COMPACT_VIEWPORT_MAX_WIDTH = 480;
const FULL_OVERLAY_OFFSET_MIN_WIDTH = 768;
const COMPACT_OVERLAY_OFFSET_WEIGHT = 0.5;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value, decimals = 3) {
  if (!Number.isFinite(value)) {
    return value ?? null;
  }

  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function normalizePoint(point) {
  if (!point) {
    return null;
  }

  const x = Number(point.x);
  const y = Number(point.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: roundNumber(x),
    y: roundNumber(y),
  };
}

function normalizeLatLng(latLng) {
  if (!latLng) {
    return null;
  }

  const lat = Number(latLng.lat ?? latLng.latitude);
  const lng = Number(latLng.lng ?? latLng.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
  };
}

function normalizeRect(rect) {
  const left = Number(rect?.left);
  const top = Number(rect?.top);
  const right = Number(rect?.right);
  const bottom = Number(rect?.bottom);
  const width = Number(rect?.width ?? right - left);
  const height = Number(rect?.height ?? bottom - top);

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    left: roundNumber(left),
    top: roundNumber(top),
    right: roundNumber(right),
    bottom: roundNumber(bottom),
    width: roundNumber(width),
    height: roundNumber(height),
  };
}

function getViewportRect() {
  if (typeof window === "undefined") {
    return null;
  }

  const width = Number(window.visualViewport?.width ?? window.innerWidth);
  const height = Number(window.visualViewport?.height ?? window.innerHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    left: 0,
    top: 0,
    right: roundNumber(width),
    bottom: roundNumber(height),
    width: roundNumber(width),
    height: roundNumber(height),
  };
}

function getIntersectionRect(firstRect, secondRect) {
  if (!firstRect || !secondRect) {
    return null;
  }

  const left = Math.max(firstRect.left, secondRect.left);
  const top = Math.max(firstRect.top, secondRect.top);
  const right = Math.min(firstRect.right, secondRect.right);
  const bottom = Math.min(firstRect.bottom, secondRect.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return normalizeRect({
    left,
    top,
    right,
    bottom,
    width,
    height,
  });
}

function getRectCenter(rect) {
  if (!rect) {
    return null;
  }

  return {
    x: roundNumber(rect.left + rect.width / 2),
    y: roundNumber(rect.top + rect.height / 2),
  };
}

function getMissionControlsOverlayRect() {
  return normalizeRect(
    getMissionControlsOverlayElement()?.getBoundingClientRect?.()
  );
}

function getMissionControlsOverlayElement() {
  if (typeof document === "undefined") {
    return null;
  }

  return document.querySelector(MISSION_CONTROLS_OVERLAY_SELECTOR);
}

function getOverlayOffsetWeight(visibleWidth) {
  if (visibleWidth <= COMPACT_VIEWPORT_MAX_WIDTH) {
    return COMPACT_OVERLAY_OFFSET_WEIGHT;
  }

  return clamp(
    COMPACT_OVERLAY_OFFSET_WEIGHT +
      ((visibleWidth - COMPACT_VIEWPORT_MAX_WIDTH) /
        (FULL_OVERLAY_OFFSET_MIN_WIDTH - COMPACT_VIEWPORT_MAX_WIDTH)) *
        (1 - COMPACT_OVERLAY_OFFSET_WEIGHT),
    COMPACT_OVERLAY_OFFSET_WEIGHT,
    1
  );
}

function getPreferredHorizontalCenterDetails(visibleRect, overlayRect) {
  const visibleCenter = getRectCenter(visibleRect);

  if (!visibleCenter) {
    return null;
  }

  const fallbackDetails = {
    visibleCenterX: visibleCenter.x,
    overlayRight: null,
    overlayBandCenterX: null,
    overlayOffsetWeight: 0,
    targetX: visibleCenter.x,
    reason: "no-overlay",
  };

  if (!overlayRect) {
    return fallbackDetails;
  }

  const overlayRight = clamp(
    overlayRect.right,
    visibleRect.left,
    visibleRect.right
  );

  if (overlayRight <= visibleRect.left || overlayRight >= visibleRect.right) {
    return {
      ...fallbackDetails,
      overlayRight,
      reason: "overlay-outside-usable-range",
    };
  }

  const overlayBandCenterX =
    overlayRight + (visibleRect.right - overlayRight) / 2;
  const overlayOffsetWeight = getOverlayOffsetWeight(visibleRect.width);
  const targetX =
    visibleCenter.x +
    (overlayBandCenterX - visibleCenter.x) * overlayOffsetWeight;

  return {
    visibleCenterX: visibleCenter.x,
    overlayRight: roundNumber(overlayRight),
    overlayBandCenterX: roundNumber(overlayBandCenterX),
    overlayOffsetWeight: roundNumber(overlayOffsetWeight, 4),
    targetX: roundNumber(targetX),
    reason: "overlay-adjusted",
  };
}

export function getBannerGuiderLocationGeometry(map) {
  const containerRect = normalizeRect(
    map?.getContainer?.()?.getBoundingClientRect?.()
  );

  if (!containerRect) {
    return {
      canCalculate: false,
      reason: "missing-map-container-rect",
    };
  }

  const viewportRect = getViewportRect();
  const visibleRect =
    getIntersectionRect(containerRect, viewportRect) ?? containerRect;
  const overlayRect = getMissionControlsOverlayRect();
  const horizontal = getPreferredHorizontalCenterDetails(
    visibleRect,
    overlayRect
  );
  const visibleCenter = getRectCenter(visibleRect);
  const mapSize = map?.getSize?.();
  const maxX = Number.isFinite(mapSize?.x) ? mapSize.x : containerRect.width;
  const maxY = Number.isFinite(mapSize?.y) ? mapSize.y : containerRect.height;
  const targetPoint = {
    x: roundNumber(clamp(horizontal?.targetX - containerRect.left, 0, maxX)),
    y: roundNumber(clamp(visibleCenter.y - containerRect.top, 0, maxY)),
  };

  return {
    canCalculate: true,
    constants: {
      compactViewportMaxWidth: COMPACT_VIEWPORT_MAX_WIDTH,
      fullOverlayOffsetMinWidth: FULL_OVERLAY_OFFSET_MIN_WIDTH,
      compactOverlayOffsetWeight: COMPACT_OVERLAY_OFFSET_WEIGHT,
    },
    containerRect,
    viewportRect,
    visibleRect,
    overlayRect,
    visibleCenter,
    horizontal,
    mapSize: {
      x: Number.isFinite(mapSize?.x) ? roundNumber(mapSize.x) : null,
      y: Number.isFinite(mapSize?.y) ? roundNumber(mapSize.y) : null,
    },
    maxPoint: {
      x: roundNumber(maxX),
      y: roundNumber(maxY),
    },
    targetPoint,
    targetPointRelativeToViewport: {
      x: roundNumber(targetPoint.x + containerRect.left),
      y: roundNumber(targetPoint.y + containerRect.top),
    },
  };
}

export function getPreferredTargetPoint(map) {
  const geometry = getBannerGuiderLocationGeometry(map);

  return geometry.canCalculate ? geometry.targetPoint : null;
}

export function getCenteredMapTarget(map, nextPosition) {
  const targetPoint = getPreferredTargetPoint(map);
  const userPoint = map.latLngToContainerPoint?.(nextPosition);
  const currentCenter = map.getCenter?.();
  const currentCenterPoint = currentCenter
    ? map.latLngToContainerPoint?.(currentCenter)
    : null;

  if (
    !targetPoint ||
    !userPoint ||
    !currentCenterPoint ||
    typeof map.containerPointToLatLng !== "function"
  ) {
    return nextPosition;
  }

  const desiredCenterPoint = {
    x: currentCenterPoint.x - (targetPoint.x - userPoint.x),
    y: currentCenterPoint.y - (targetPoint.y - userPoint.y),
  };
  const desiredCenter = map.containerPointToLatLng(desiredCenterPoint);

  if (!Number.isFinite(desiredCenter?.lat) || !Number.isFinite(desiredCenter?.lng)) {
    return nextPosition;
  }

  return desiredCenter;
}

function getVisualViewportDebug() {
  if (typeof window === "undefined" || !window.visualViewport) {
    return null;
  }

  return {
    width: roundNumber(window.visualViewport.width),
    height: roundNumber(window.visualViewport.height),
    offsetLeft: roundNumber(window.visualViewport.offsetLeft),
    offsetTop: roundNumber(window.visualViewport.offsetTop),
    pageLeft: roundNumber(window.visualViewport.pageLeft),
    pageTop: roundNumber(window.visualViewport.pageTop),
    scale: roundNumber(window.visualViewport.scale, 4),
  };
}

function getScreenDebug() {
  if (typeof window === "undefined" || !window.screen) {
    return null;
  }

  return {
    width: Number(window.screen.width) || null,
    height: Number(window.screen.height) || null,
    availWidth: Number(window.screen.availWidth) || null,
    availHeight: Number(window.screen.availHeight) || null,
    orientationType: window.screen.orientation?.type ?? null,
    orientationAngle: Number.isFinite(window.screen.orientation?.angle)
      ? window.screen.orientation.angle
      : null,
  };
}

function getElementComputedStyleDebug(element) {
  if (typeof window === "undefined" || !element) {
    return null;
  }

  const style = window.getComputedStyle(element);

  return {
    display: style.display,
    position: style.position,
    top: style.top,
    right: style.right,
    bottom: style.bottom,
    left: style.left,
    width: style.width,
    height: style.height,
    margin: style.margin,
    padding: style.padding,
    transform: style.transform,
    zIndex: style.zIndex,
  };
}

function getDocumentDebug() {
  if (typeof document === "undefined") {
    return null;
  }

  const documentElement = document.documentElement;
  const body = document.body;

  return {
    visibilityState: document.visibilityState,
    documentElement: documentElement
      ? {
          clientWidth: documentElement.clientWidth,
          clientHeight: documentElement.clientHeight,
          scrollWidth: documentElement.scrollWidth,
          scrollHeight: documentElement.scrollHeight,
          offsetWidth: documentElement.offsetWidth,
          offsetHeight: documentElement.offsetHeight,
        }
      : null,
    body: body
      ? {
          clientWidth: body.clientWidth,
          clientHeight: body.clientHeight,
          scrollWidth: body.scrollWidth,
          scrollHeight: body.scrollHeight,
          offsetWidth: body.offsetWidth,
          offsetHeight: body.offsetHeight,
        }
      : null,
  };
}

export function getBannerGuiderLocationDebugInfo({
  map,
  bannerId,
  currentMission,
  missionCount,
  locationSnapshot = null,
}) {
  const mapContainer = map?.getContainer?.();
  const overlayElement = getMissionControlsOverlayElement();
  const geometry = getBannerGuiderLocationGeometry(map);
  const currentCenter = normalizeLatLng(map?.getCenter?.());
  const lastPosition = normalizeLatLng(locationSnapshot?.position);
  const userPoint = lastPosition
    ? normalizePoint(map?.latLngToContainerPoint?.(lastPosition))
    : null;
  const targetPoint = geometry.canCalculate ? geometry.targetPoint : null;
  const currentCenterPoint = currentCenter
    ? normalizePoint(map?.latLngToContainerPoint?.(currentCenter))
    : null;
  const desiredCenterPoint =
    targetPoint && userPoint && currentCenterPoint
      ? {
          x: roundNumber(currentCenterPoint.x - (targetPoint.x - userPoint.x)),
          y: roundNumber(currentCenterPoint.y - (targetPoint.y - userPoint.y)),
        }
      : null;
  const desiredCenter = desiredCenterPoint
    ? normalizeLatLng(map?.containerPointToLatLng?.(desiredCenterPoint))
    : null;

  return {
    collectedAt: new Date().toISOString(),
    page: typeof window === "undefined" ? null : window.location.href,
    bannerId,
    currentMission,
    missionCount,
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
    devicePixelRatio:
      typeof window === "undefined" ? null : roundNumber(window.devicePixelRatio, 4),
    window: typeof window === "undefined"
      ? null
      : {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          scrollX: roundNumber(window.scrollX),
          scrollY: roundNumber(window.scrollY),
        },
    visualViewport: getVisualViewportDebug(),
    screen: getScreenDebug(),
    document: getDocumentDebug(),
    computedStyles: {
      mapContainer: getElementComputedStyleDebug(mapContainer),
      overlay: getElementComputedStyleDebug(overlayElement),
    },
    map: {
      available: Boolean(map),
      zoom: Number.isFinite(map?.getZoom?.()) ? map.getZoom() : null,
      center: currentCenter,
      centerPoint: currentCenterPoint,
      bounds: map?.getBounds?.()
        ? {
            southWest: normalizeLatLng(map.getBounds()._southWest),
            northEast: normalizeLatLng(map.getBounds()._northEast),
          }
        : null,
    },
    locationSnapshot,
    projectedLocationPoint: userPoint,
    projectedDesiredCenterPoint: desiredCenterPoint,
    projectedDesiredCenter: desiredCenter,
    geometry,
  };
}
