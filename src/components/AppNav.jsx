import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookmarksOutlined,
  Bookmarks,
  Explore,
  ExploreOutlined,
  Search as SearchIcon,
  SearchOutlined,
  Map as MapIcon,
  MapOutlined,
} from "@mui/icons-material";
import { getBrowseStateScope, resetBrowseState } from "../browseState";
import { t, tk } from "../i18n";
import AppLogo from "./AppLogo";

const NAV_ITEMS = [
  {
    key: "banners",
    label: tk("Banners"),
    to: "/",
    icon: ExploreOutlined,
    activeIcon: Explore,
    match: (pathname) =>
      pathname === "/" ||
      pathname === "/near" ||
      pathname.startsWith("/browse") ||
      pathname.startsWith("/agent/") ||
      pathname.startsWith("/banner/"),
  },
  {
    key: "search",
    label: tk("Search"),
    to: "/search",
    icon: SearchOutlined,
    activeIcon: SearchIcon,
    match: (pathname) => pathname.startsWith("/search"),
  },
  {
    key: "map",
    label: tk("Map"),
    to: "/map",
    icon: MapOutlined,
    activeIcon: MapIcon,
    match: (pathname) => pathname.startsWith("/map"),
  },
  {
    key: "lists",
    label: tk("Lists"),
    to: "/lists",
    icon: BookmarksOutlined,
    activeIcon: Bookmarks,
    match: (pathname) => pathname.startsWith("/lists"),
  },
];

export default function AppNav() {
  const { pathname } = useLocation();

  return (
    <nav className="ob-nav" aria-label={t("Main")}>
      <Link className="ob-nav-brand" to="/" aria-label={t("OpenBanners home")} tabIndex={-1}>
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
              if (item.key === "banners") {
                resetBrowseState(getBrowseStateScope());
              }
            }}
          >
            <span className="ind sl">
              <Icon fontSize="small" />
            </span>
            <span>{t(item.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
