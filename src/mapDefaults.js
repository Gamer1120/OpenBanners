// Where a map starts when there is nothing better (no saved view, no
// location yet): the world, not one city. Banner, plan and guider maps fit
// their content right away; this is only what shows before that.
export const WORLD_PLACEHOLDER = Object.freeze({ center: [25, 10], zoom: 2 });

// South American time zones (America/… is otherwise North America).
const SOUTH_AMERICA = /^America\/(?:Argentina|Sao_Paulo|Bahia|Belem|Fortaleza|Recife|Maceio|Araguaina|Manaus|Cuiaba|Campo_Grande|Porto_Velho|Boa_Vista|Rio_Branco|Eirunepe|Noronha|Santarem|Bogota|Lima|Santiago|Caracas|La_Paz|Asuncion|Montevideo|Guayaquil|Cayenne|Paramaribo|Guyana|Punta_Arenas)/;

// A rough centre for the visitor's part of the world, from the browser's
// time zone (no request, no permission). [latitude, longitude].
export function regionCenterForTimeZone(timeZone) {
  const zone = typeof timeZone === "string" ? timeZone : "";

  if (SOUTH_AMERICA.test(zone)) {
    return [-15, -60];
  }
  if (/^(?:America|Canada|US)\//.test(zone)) {
    return [38, -95];
  }
  if (/^(?:Australia\/|Pacific\/(?:Auckland|Chatham|Fiji))/.test(zone)) {
    return [-28, 145];
  }
  if (/^Asia\/(?:Tokyo|Seoul|Shanghai|Hong_Kong|Taipei|Manila|Singapore|Kuala_Lumpur|Jakarta|Bangkok|Ho_Chi_Minh|Saigon|Makassar|Jayapura|Pontianak)/.test(zone)) {
    return [25, 118];
  }
  if (/^(?:Asia|Indian)\//.test(zone)) {
    return [28, 80];
  }
  if (/^Africa\//.test(zone)) {
    return [8, 20];
  }
  if (/^(?:Europe|Atlantic)\//.test(zone)) {
    return [48, 12];
  }

  return WORLD_PLACEHOLDER.center;
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

// /map without a saved view or location: the visitor's part of the world
// (zoom 3, or 4 on very tall screens), centred from the time zone. One level
// closer than a whole-world view (2026-10-30, Michael: it could be zoomed in
// one more level when opened fresh). A phone shows a large part of a
// continent, a desktop about a continent.
export function getWorldView({
  height = typeof window === "undefined" ? 844 : window.innerHeight,
  timeZone = browserTimeZone(),
} = {}) {
  const fill = Math.ceil(Math.log2(Math.max(1, height) / 256));
  const zoom = Math.min(4, Math.max(3, (Number.isFinite(fill) ? fill : 2) + 1));
  return { center: regionCenterForTimeZone(timeZone), zoom };
}
