import React, { useState } from "react";
import { Place } from "@mui/icons-material";
import AboutNotice from "../AboutNotice";
import BannerInfo from "../BannerInfo";
import BannerImage from "../BannerImage";
import MarkDoneNotice from "../MarkDoneNotice";
import { PassphraseDonePrompt, PassphrasePanel } from "./Passphrases";
import BannerNotes, { AddNoteButton, useBannerNotes } from "./BannerNotes";
import {
  AddressLink,
  BannerDetailsList,
  BannerTitle,
  BannergressLink,
  Byline,
  Description,
  DetailTabs,
  ErrorAlert,
  HeroArt,
  KeyNumbers,
  ListActions,
  MapSection,
  MissionList,
  MissionsHeader,
  StatusAlerts,
  useBannerDetails,
} from "./shared";
import { t } from "../../i18n";

const LONG_DESCRIPTION = 240;

// A · Compact: small hero with a plain "by X" byline, About right under the hero,
// one row of start actions, order as a key number. Mobile tabs, map beside on desktop.
export default function DesignA() {
  const d = useBannerDetails({ tabs: true });
  const [aboutOpen, setAboutOpen] = useState(false);
  const notes = useBannerNotes(d);
  const description = d.items.description || "";
  const isLong = description.length > LONG_DESCRIPTION;

  return (
    <div className="bp bpa">
      {d.showPane ? null : <DetailTabs d={d} />}
      <section
        className={`bp-pane${d.effectiveListType ? ` ls-${d.effectiveListType}` : ""}`}
        hidden={!d.showPane}
        aria-label={t("Banner details")}
      >
        <header className="bp-hero a-hero">
          <BannerImage banner={d.items} mode="backdrop" className="bp-hero-bg" />
          <div className="bp-hero-inner">
            <HeroArt d={d} />
            <BannerTitle d={d} />
            {!d.isLoading && !d.error ? (
              <>
                <Byline d={d} />
                <p className="bp-sub">
                  <Place fontSize="small" />
                  <AddressLink d={d} />
                </p>
              </>
            ) : null}
          </div>
        </header>

        {d.showPane ? <DetailTabs d={d} /> : null}

        {d.error ? (
          <div className="bp-view">
            <ErrorAlert d={d} />
          </div>
        ) : (
          <>
            <div className="bp-view" role="tabpanel" hidden={d.paneTab !== "overview"}>
              <section className="a-about" aria-label={t("About")}>
                <Description
                  d={d}
                  className={`desc${isLong && !aboutOpen ? " a-clamp" : ""}`}
                />
                {!d.isLoading && isLong ? (
                  <button
                    type="button"
                    className="btn text sl a-more"
                    aria-expanded={aboutOpen}
                    onClick={() => setAboutOpen((open) => !open)}
                  >
                    {aboutOpen ? t("Show less") : t("Read more")}
                  </button>
                ) : null}
              </section>
              <StatusAlerts d={d} />
              <ListActions d={d} />
              <BannerNotes notes={notes} />
              <BannerInfo banner={d.items} loading={d.isLoading} variant="row" />
              <KeyNumbers
                d={d}
                keys={["distance", "missions", "time", "uniques", "perKm", "order"]}
                className="stats a-stats"
              />
              <BannerDetailsList d={d} />
              <div className="bn-links">
                <BannergressLink d={d} button />
                <AddNoteButton notes={notes} />
              </div>
              <AboutNotice className="bp-about" />
            </div>

            <div className="bp-view" role="tabpanel" hidden={d.paneTab !== "missions"}>
              <MissionsHeader d={d} />
              <PassphrasePanel d={d} />
              <MissionList d={d} />
            </div>
          </>
        )}
      </section>

      <MapSection d={d} />
      <MarkDoneNotice bannerId={d.bannerId} />
      <PassphraseDonePrompt d={d} />
    </div>
  );
}
