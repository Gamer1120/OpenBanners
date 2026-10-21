import React, { useEffect, useState } from "react";
import { CloseFullscreen, OpenInFull, Place } from "@mui/icons-material";
import AboutNotice from "../AboutNotice";
import BannerInfo from "../BannerInfo";
import BannerImage from "../BannerImage";
import {
  AddressLink,
  BannerTitle,
  BannergressLink,
  Byline,
  Description,
  ErrorAlert,
  HeroArt,
  ListActions,
  MapSection,
  MissionList,
  MissionsHeader,
  StatusAlerts,
  isLiveMap,
  useBannerDetails,
} from "./shared";

function FactsLine({ d }) {
  if (d.isLoading) {
    return null;
  }

  const facts = [
    `${d.missionCount} missions`,
    d.distanceLabel,
    d.durationLabel ? `about ${d.durationLabel}` : null,
    d.perKmLabel ? `${d.perKmLabel} missions/km` : null,
    d.orderLabel ? d.orderLabel.toLowerCase() : null,
  ].filter(Boolean);

  return (
    <p className="b-facts" aria-label="Key numbers">
      {facts.map((fact, index) => (
        <React.Fragment key={fact}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          <span>{fact}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

// B · Story: big hero, the description first, numbers as one slim line, then the
// route (inline map on phones, full-screen on demand) and the missions. No tabs.
export default function DesignB() {
  const d = useBannerDetails({ tabs: false });
  const [fullMap, setFullMap] = useState(false);
  const inlineMap = d.isMobile && !fullMap;

  // Inline on a phone the map must not swallow the page scroll: one finger scrolls
  // the page, two fingers zoom, full screen pans freely.
  useEffect(() => {
    const map = d.mapInstance;

    if (!isLiveMap(map) || !map.dragging) {
      return;
    }

    if (inlineMap) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [d.mapInstance, inlineMap]);

  useEffect(() => {
    if (!d.isMobile) {
      setFullMap(false);
    }
  }, [d.isMobile]);

  const map = (
    <MapSection
      d={d}
      className={d.isMobile ? `b-map${fullMap ? " b-full" : ""}` : ""}
      onShowInList={(index) => {
        setFullMap(false);
        d.showInList(index);
      }}
    >
      {d.isMobile ? (
        <button
          type="button"
          className="icon-btn sl"
          aria-label={fullMap ? "Close full-screen map" : "Full-screen map"}
          title={fullMap ? "Close full-screen map" : "Full-screen map"}
          onClick={() => setFullMap((open) => !open)}
        >
          {fullMap ? <CloseFullscreen /> : <OpenInFull />}
        </button>
      ) : null}
    </MapSection>
  );

  return (
    <div className="bp bpb">
      <section
        className={`bp-pane b-pane${d.effectiveListType ? ` ls-${d.effectiveListType}` : ""}`}
        aria-label="Banner details"
      >
        <header className="bp-hero b-hero">
          <BannerImage banner={d.items} mode="backdrop" className="bp-hero-bg" />
          <div className="bp-hero-inner">
            <HeroArt d={d} />
            {!d.isLoading && !d.error ? (
              <p className="b-kicker">
                <Place fontSize="small" />
                <AddressLink d={d} />
              </p>
            ) : null}
            <BannerTitle d={d} className="bp-title b-title" />
            {!d.isLoading && !d.error ? <Byline d={d} prefix="A banner by" /> : null}
          </div>
        </header>

        <article className="bp-view b-body">
          {d.error ? (
            <ErrorAlert d={d} />
          ) : (
            <>
              <Description d={d} className="desc b-lede" />
              <FactsLine d={d} />
              <StatusAlerts d={d} />
              <ListActions d={d} />
              <BannerInfo banner={d.items} loading={d.isLoading} />
              <h2 className="b-h">The route</h2>
              {d.isMobile ? map : null}
              <MissionsHeader d={d} />
              <MissionList d={d} />
              <BannergressLink d={d} />
              <AboutNotice className="bp-about" />
            </>
          )}
        </article>
      </section>

      {d.isMobile ? null : map}
    </div>
  );
}
