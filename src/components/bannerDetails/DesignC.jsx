import React, { useEffect, useState } from "react";
import { ExpandMore } from "@mui/icons-material";
import AboutNotice from "../AboutNotice";
import BannerInfo from "../BannerInfo";
import BannerImage from "../BannerImage";
import {
  AddressLink,
  BannerTitle,
  BannergressLink,
  Byline,
  Description,
  DetailTabs,
  ErrorAlert,
  KeyNumbers,
  ListActions,
  MapSection,
  MissionList,
  MissionsHeader,
  StatusAlerts,
  useBannerDetails,
} from "./shared";

// C · Dashboard: thumbnail header, a sticky bar with the start actions and tabs,
// a stats grid that includes the order, a collapsible About near the top and a
// facts table with the author(s).
export default function DesignC() {
  const d = useBannerDetails({ tabs: true });
  const description = d.items.description || "";
  const [aboutOpen, setAboutOpen] = useState(false);

  // Short descriptions are simply shown; long ones start folded.
  useEffect(() => {
    setAboutOpen(description.length > 0 && description.length <= 160);
  }, [description]);

  const tabs = (
    <DetailTabs
      d={d}
      labels={{
        overview: "Info",
        missions: d.isLoading ? "Missions" : `Missions (${d.missionCount})`,
        map: "Map",
      }}
    />
  );

  return (
    <div className="bp bpc">
      {d.showPane ? null : tabs}
      <section
        className={`bp-pane c-pane${d.effectiveListType ? ` ls-${d.effectiveListType}` : ""}`}
        hidden={!d.showPane}
        aria-label="Banner details"
      >
        <header className="c-head">
          <BannerImage banner={d.items} className="c-thumb" minAspect={3} eager />
          <div className="c-headtxt">
            <BannerTitle d={d} className="bp-title c-title" />
            {!d.isLoading && !d.error ? (
              <p className="c-sub">
                <AddressLink d={d} />
              </p>
            ) : null}
          </div>
        </header>

        {d.error ? (
          <div className="bp-view">
            <ErrorAlert d={d} />
          </div>
        ) : (
          <>
            <div className="c-bar">
              <BannerInfo
                banner={d.items}
                loading={d.isLoading}
                variant="row"
                heading={null}
                className="c-actions"
              />
              {tabs}
            </div>

            <div className="bp-view" role="tabpanel" hidden={d.paneTab !== "overview"}>
              <StatusAlerts d={d} />
              {d.isLoading || description ? (
                <section className={`c-about${aboutOpen ? " open" : ""}`}>
                  <button
                    type="button"
                    className="c-about-h sl"
                    aria-expanded={aboutOpen}
                    aria-controls="c-about-body"
                    onClick={() => setAboutOpen((open) => !open)}
                  >
                    <span className="grow">About</span>
                    <ExpandMore className="chev" />
                  </button>
                  <div id="c-about-body" className={aboutOpen ? "" : "c-peek"}>
                    <Description d={d} />
                  </div>
                </section>
              ) : null}
              <KeyNumbers
                d={d}
                keys={["distance", "missions", "time", "perKm", "order", "waypoints"]}
                className="stats c-grid"
              />
              <ListActions d={d} />
              {!d.isLoading ? (
                <dl className="c-facts">
                  {d.authors.length ? (
                    <div>
                      <dt>Made by</dt>
                      <dd>
                        <Byline d={d} prefix="" />
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Start</dt>
                    <dd>
                      <AddressLink d={d} />
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      <BannergressLink d={d} className="" />
                    </dd>
                  </div>
                </dl>
              ) : null}
              <AboutNotice className="bp-about" />
            </div>

            <div className="bp-view" role="tabpanel" hidden={d.paneTab !== "missions"}>
              <MissionsHeader d={d} />
              <MissionList d={d} />
            </div>
          </>
        )}
      </section>

      <MapSection d={d} />
    </div>
  );
}
