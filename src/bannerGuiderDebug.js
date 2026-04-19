const MAX_BANNER_GUIDER_DEBUG_ENTRIES = 500;

const bannerGuiderDebugEntries = [];

function sanitizeDetails(details) {
  if (!details || typeof details !== "object") {
    return details ?? null;
  }

  try {
    return JSON.parse(JSON.stringify(details));
  } catch (_error) {
    return {
      unserializable: true,
      detailType: Object.prototype.toString.call(details),
    };
  }
}

export function logBannerGuiderDebug(label, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    label,
    details: sanitizeDetails(details),
  };

  bannerGuiderDebugEntries.push(entry);

  if (bannerGuiderDebugEntries.length > MAX_BANNER_GUIDER_DEBUG_ENTRIES) {
    bannerGuiderDebugEntries.splice(
      0,
      bannerGuiderDebugEntries.length - MAX_BANNER_GUIDER_DEBUG_ENTRIES
    );
  }

  console.log(`[BannerGuider] ${label}`, entry);
  return entry;
}

export function clearBannerGuiderDebugLog(context = {}) {
  bannerGuiderDebugEntries.length = 0;
  logBannerGuiderDebug("debug-log-cleared", context);
}

export function getBannerGuiderDebugEntries() {
  return bannerGuiderDebugEntries.slice();
}

export function getBannerGuiderDebugLogText() {
  return getBannerGuiderDebugEntries()
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.timestamp} ${entry.label}\n${JSON.stringify(entry.details, null, 2)}`
    )
    .join("\n\n");
}
