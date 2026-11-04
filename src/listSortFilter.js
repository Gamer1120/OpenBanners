import { tk } from "./i18n";

// Sort and filter of the Lists page (To do / Done / Hidden / Yours). All of it
// is done by Bannergress (/bnrs orderBy, orderDirection, online, query), so
// paging keeps working; "Closest"/"Furthest" send the visitor's coordinates
// (proximityStartPoint needs proximityLatitude + proximityLongitude).
export const LIST_SORTS = [
  { id: "added-desc", orderBy: "listAdded", direction: "DESC", label: tk("Recently added"), listsOnly: true },
  { id: "added-asc", orderBy: "listAdded", direction: "ASC", label: tk("Added longest ago"), listsOnly: true },
  { id: "closest", orderBy: "proximityStartPoint", direction: "ASC", label: tk("Closest first"), needsLocation: true },
  { id: "furthest", orderBy: "proximityStartPoint", direction: "DESC", label: tk("Furthest first"), needsLocation: true },
  { id: "title-asc", orderBy: "title", direction: "ASC", label: tk("A–Z") },
  { id: "title-desc", orderBy: "title", direction: "DESC", label: tk("Z–A") },
  { id: "missions-desc", orderBy: "numberOfMissions", direction: "DESC", label: tk("Most missions") },
  { id: "missions-asc", orderBy: "numberOfMissions", direction: "ASC", label: tk("Fewest missions") },
  { id: "length-desc", orderBy: "lengthMeters", direction: "DESC", label: tk("Longest first") },
  { id: "length-asc", orderBy: "lengthMeters", direction: "ASC", label: tk("Shortest first") },
  { id: "created-desc", orderBy: "created", direction: "DESC", label: tk("Newest banners") },
  { id: "created-asc", orderBy: "created", direction: "ASC", label: tk("Oldest banners") },
];

export const LIST_STATUS_FILTERS = [
  { id: "all", label: tk("All") },
  { id: "online", label: tk("Online") },
  { id: "offline", label: tk("Offline") },
];

export const LIST_VIEW_STORAGE_KEY = "openbanners-lists-view";
const DEFAULT_LIST_SORT = "added-desc";
// "Yours" isn't a Bannergress list, so it can't sort by date added.
const DEFAULT_YOURS_SORT = "created-desc";

export function getListSort(id) {
  return LIST_SORTS.find((sort) => sort.id === id) ?? null;
}

export function defaultSortFor(listType) {
  return listType === "yours" ? DEFAULT_YOURS_SORT : DEFAULT_LIST_SORT;
}

export function sortsFor(listType) {
  return listType === "yours" ? LIST_SORTS.filter((sort) => !sort.listsOnly) : LIST_SORTS;
}

// The sort a tab actually uses: a date-added sort picked on a list falls back
// to "Newest banners" on Yours (and back again on the lists).
export function effectiveSortId(sortId, listType) {
  return sortsFor(listType).some((sort) => sort.id === sortId) ? sortId : defaultSortFor(listType);
}

export function readListView() {
  const fallback = { sort: DEFAULT_LIST_SORT, yoursSort: DEFAULT_YOURS_SORT, status: "all" };

  try {
    const stored = JSON.parse(window.localStorage.getItem(LIST_VIEW_STORAGE_KEY) ?? "null");

    return {
      sort: getListSort(stored?.sort) ? stored.sort : fallback.sort,
      yoursSort:
        getListSort(stored?.yoursSort) && !getListSort(stored.yoursSort).listsOnly
          ? stored.yoursSort
          : fallback.yoursSort,
      status: LIST_STATUS_FILTERS.some((filter) => filter.id === stored?.status)
        ? stored.status
        : fallback.status,
    };
  } catch {
    return fallback;
  }
}

export function saveListView(view) {
  try {
    window.localStorage.setItem(LIST_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Private mode / full storage: the choice just isn't remembered.
  }
}

// Adds the sort and filter parameters to a /bnrs URL.
export function applyListSortFilter(url, { sortId, status, query, location }) {
  const sort = getListSort(sortId) ?? getListSort(DEFAULT_LIST_SORT);

  url.searchParams.set("orderBy", sort.orderBy);
  url.searchParams.set("orderDirection", sort.direction);

  if (sort.needsLocation) {
    url.searchParams.set("proximityLatitude", String(location.latitude));
    url.searchParams.set("proximityLongitude", String(location.longitude));
  }

  if (status === "online") {
    url.searchParams.set("online", "true");
  } else if (status === "offline") {
    url.searchParams.set("online", "false");
  }

  if (query) {
    url.searchParams.set("query", query);
  }

  return url;
}
