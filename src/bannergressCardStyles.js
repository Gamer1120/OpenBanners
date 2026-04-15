const defaultSurface = {
  backgroundColor: "rgba(18, 25, 31, 0.78)",
  backgroundImage:
    "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%)",
  borderColor: "rgba(255,255,255,0.08)",
  hoverBackgroundColor: "rgba(24, 31, 38, 0.92)",
  hoverBorderColor: "rgba(255,255,255,0.18)",
};

const listTypeSurfaces = {
  todo: {
    backgroundColor: "rgba(17, 55, 82, 0.82)",
    backgroundImage:
      "linear-gradient(180deg, rgba(89, 175, 235, 0.2) 0%, rgba(16, 37, 49, 0.94) 100%)",
    borderColor: "rgba(138, 208, 255, 0.24)",
    hoverBackgroundColor: "rgba(21, 67, 98, 0.94)",
    hoverBorderColor: "rgba(168, 222, 255, 0.34)",
  },
  done: {
    backgroundColor: "rgba(22, 63, 37, 0.82)",
    backgroundImage:
      "linear-gradient(180deg, rgba(112, 214, 142, 0.18) 0%, rgba(18, 39, 26, 0.94) 100%)",
    borderColor: "rgba(154, 236, 174, 0.22)",
    hoverBackgroundColor: "rgba(25, 75, 43, 0.94)",
    hoverBorderColor: "rgba(173, 244, 191, 0.3)",
  },
  blacklist: {
    backgroundColor: "rgba(73, 29, 29, 0.82)",
    backgroundImage:
      "linear-gradient(180deg, rgba(233, 121, 121, 0.16) 0%, rgba(44, 19, 19, 0.94) 100%)",
    borderColor: "rgba(245, 168, 168, 0.2)",
    hoverBackgroundColor: "rgba(88, 34, 34, 0.94)",
    hoverBorderColor: "rgba(255, 189, 189, 0.28)",
  },
};

export function getBannergressCardSurface(listType) {
  return listTypeSurfaces[listType] ?? defaultSurface;
}
