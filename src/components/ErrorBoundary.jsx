import React from "react";
import { t } from "../i18n";

// A render error shows a friendly message with Reload instead of a white
// page. resetKey (e.g. the path) clears the error when it changes, so
// navigating elsewhere works again without a reload.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("OpenBanners crashed while rendering:", error, info?.componentStack ?? "");
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="ob-page ob-crash" role="alert">
        <h1 className="ob-h1">{t("Something went wrong")}</h1>
        <p className="muted">{t("OpenBanners ran into an error on this page. Reloading usually fixes it.")}</p>
        <div className="ob-crash-acts">
          <button type="button" className="btn filled sl" onClick={() => window.location.reload()}>
            {t("Reload")}
          </button>
          <a className="btn text sl" href="/">
            {t("Go to home page")}
          </a>
        </div>
      </div>
    );
  }
}
