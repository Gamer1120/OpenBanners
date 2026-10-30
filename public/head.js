// Runs before the app (index.html <head>). A file, not inline <script>,
// so the Content-Security-Policy can be script-src 'self'.
// Dark only: forget the old light/system choice.
try {
  localStorage.removeItem("openbanners-theme-mode");
} catch (error) {}
(function () {
  const origin = window.location.origin || "https://openbanners.org";
  const currentUrl = new URL(
    `${window.location.pathname}${window.location.search}`,
    origin
  ).toString();

  const ensureMeta = (attribute, name) => {
    let element = document.head.querySelector(
      `meta[${attribute}="${name}"]`
    );

    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, name);
      document.head.appendChild(element);
    }

    return element;
  };

  const setMeta = (attribute, name, content) => {
    ensureMeta(attribute, name).setAttribute("content", content);
  };

  let canonicalLink = document.head.querySelector('link[rel="canonical"]');
  if (!canonicalLink) {
    canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    document.head.appendChild(canonicalLink);
  }
  canonicalLink.setAttribute("href", currentUrl);
  setMeta("property", "og:url", currentUrl);

  // Banner pages: the meta service (server/banner-meta.mts) already puts
  // the banner's tags in this HTML and the app sets them after loading
  // the banner, so there is no second Bannergress request here.
})();
