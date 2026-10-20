import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookmarksOutlined,
  Bookmarks,
  Explore,
  ExploreOutlined,
  Home as HomeIcon,
  HomeOutlined,
  Map as MapIcon,
  MapOutlined,
} from "@mui/icons-material";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import AppLogo from "./AppLogo";

const NAV_ITEMS = [
  {
    key: "home",
    label: "Home",
    to: "/",
    icon: HomeOutlined,
    activeIcon: HomeIcon,
    match: (pathname) => pathname === "/" || pathname.startsWith("/search/"),
  },
  {
    key: "browse",
    label: "Browse",
    to: "/browse/",
    icon: ExploreOutlined,
    activeIcon: Explore,
    match: (pathname) =>
      pathname.startsWith("/browse") ||
      pathname.startsWith("/agent/") ||
      pathname.startsWith("/banner/") ||
      pathname.startsWith("/together/"),
  },
  {
    key: "map",
    label: "Map",
    to: "/map",
    icon: MapOutlined,
    activeIcon: MapIcon,
    match: (pathname) => pathname.startsWith("/map"),
  },
  {
    key: "lists",
    label: "Lists",
    to: "/lists",
    icon: BookmarksOutlined,
    activeIcon: Bookmarks,
    match: (pathname) => pathname.startsWith("/lists"),
  },
];

export default function AppNav() {
  const { pathname } = useLocation();

  return (
    <nav className="ob-nav" aria-label="Main">
      <Link className="ob-nav-brand" to="/" aria-label="OpenBanners home" tabIndex={-1}>
        <AppLogo />
      </Link>
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        const Icon = active ? item.activeIcon : item.icon;

        return (
          <Link
            key={item.key}
            to={item.to}
            className="ob-nav-item"
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (item.key === "browse") {
                resetBrowseState(getBrowseStateScope());
              }
            }}
          >
            <span className="ind sl">
              <Icon fontSize="small" />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
