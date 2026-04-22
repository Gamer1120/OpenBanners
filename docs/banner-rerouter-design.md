# Banner Rerouter Design For OpenBanners

## Goal

Add a first-party Banner Rerouter flow to OpenBanners that lets a user:

1. Import an existing banner as a UMM mission-set file
2. Review all imported portals from that banner
3. Remove portals they do not want to keep in the rerouted banner
4. Choose banner metadata, mission count, and a start portal
5. Generate a rerouted banner route that stays similar to the imported banner where practical
6. Review the rerouted result on a map
7. Keep local route history and restore earlier reroutes
8. Export the rerouted banner back to UMM JSON

This document only designs the OpenBanners-side rerouter flow. It does not implement it.

## Local-Only Requirement

Banner Rerouter must run entirely on the user's machine.

That means:

- imported UMM files are read locally through browser file APIs
- imported banner data is processed only in browser memory, `localStorage`, `IndexedDB`, and Web Workers
- portal exclusion and reroute generation run only in the browser on the user's device
- route history is stored only on the user's device
- generated UMM exports are produced only on the user's device

That also means Banner Rerouter must not:

- upload imported UMM data to any OpenBanners server
- send portal-pool or generated-route payloads to any third-party routing service
- depend on a backend job runner for route generation
- store rerouter drafts or history remotely
- require cloud compute for any rerouter-domain calculation

The rest of OpenBanners may continue to use network requests for unrelated browsing features, but the Banner Rerouter domain itself must remain local-first and local-only.

## Product Positioning

OpenBanners already has:

- route-driven browsing in [`src/App.jsx`](/home/michael/OpenBanners/src/App.jsx)
- a map-based banner viewer in [`src/components/BannerDetailsPage.jsx`](/home/michael/OpenBanners/src/components/BannerDetailsPage.jsx)
- a mission-route viewer in [`src/components/BannerGuider.jsx`](/home/michael/OpenBanners/src/components/BannerGuider.jsx)
- shared mission rendering in [`src/components/BannerMarkers.jsx`](/home/michael/OpenBanners/src/components/BannerMarkers.jsx) and [`src/components/Mission.jsx`](/home/michael/OpenBanners/src/components/Mission.jsx)
- small client-side persisted state via [`src/bannergressSync.js`](/home/michael/OpenBanners/src/bannergressSync.js)

The new Banner Rerouter should feel like a native OpenBanners feature, not a Telegram-bot transplant. The web app should frame the workflow as:

- import an existing banner
- inspect its portals
- remove the ones you do not want
- reroute the banner locally

## Scope

### In scope for the first implementation

- A dedicated rerouter route in OpenBanners
- UMM import of an existing banner
- Normalization of imported portals into a reroutable pool
- Portal exclusion and restoration before generation
- Start-portal selection
- Mission count editing
- Local reroute generation in the browser
- Route preview on a map
- Route history with restore
- Export of the rerouted banner back to UMM JSON

### Explicitly out of scope for the first implementation

- AI image generation
- Telegram integration
- Mission submission to Niantic
- Authentication/token handling
- Multi-user collaboration or server-side drafts
- Any server-side rerouter processing

These later features should be enabled by the data model chosen here, but they should not block the first rerouter release.

## Primary UX

### New route

Add a new route:

- `/rerouter`

Optional future deep-link routes:

- `/rerouter/:draftId`
- `/rerouter/import`

For the first version, `/rerouter` is enough.

### Entry points

Add entry points in:

- `TopMenu`: new `Reroute Banner` action
- `BannerDetailsPage`: optional future `Reroute This Banner` action

For v1, only the top-level `Reroute Banner` button is required.

### Rerouter screen layout

Use a desktop split layout and a stacked mobile layout.

#### Left column / top section

- Import panel
- Imported banner summary
- Portal review and exclusion panel
- Start portal picker
- Reroute controls
- Route history

#### Right column / bottom section

- Rerouted route preview map
- Reroute summary
- Export actions

### Core user flow

1. User opens `/rerouter`
2. User imports an existing banner as a UMM file
3. App parses the mission set and extracts all unique portals into a reroutable pool
4. User sees imported metadata, geographic coverage, duplicate count, and active portal count
5. User removes portals they do not want in the rerouted banner
6. User edits:
   - banner title
   - banner description
   - number of missions
   - optional reroute preferences
7. User chooses a start portal from the remaining active pool
8. User clicks `Generate Reroute`
9. App computes a rerouted mission set and stores a route-history snapshot
10. User can:
   - regenerate
   - restore a previous reroute
   - export the rerouted banner as UMM JSON

## UMM Import Contract

### Input assumption

The imported file is a UMM mission-set JSON similar to the current Python `BannerCreator` export shape, for example:

- top-level mission-set metadata
- `missions[]`
- each mission has `portals[]`
- each portal has `guid`, `title`, `location.latitude`, `location.longitude`, optional `imageUrl`

The current Python exporter in `BannerCreator` writes exactly this shape in [`banner_creator/routing.py`](/mnt/c/Users/Michael/PycharmProjects/BannerCreator/banner_creator/routing.py:856).

### Interpretation rule

OpenBanners should treat imported UMM data as a **source banner plus reroutable portal pool**, not as a committed final route.

That means:

- preserve the original mission ordering as reference data
- flatten all mission portals into one unique reroutable set
- allow the user to exclude portals from the active reroute pool
- ignore original mission boundaries during reroute generation
- preserve imported metadata as initial defaults only

This replaces the Telegram bot’s CSV import with a more product-native model:

- the user imports an existing banner
- OpenBanners turns that banner into a local rerouting workspace

All import parsing must happen locally in the browser. The raw file contents must never leave the device.

### Why this is the right replacement for CSV

- UMM already contains all fields the rerouter needs:
  - GUID
  - title
  - coordinates
  - optional image
  - optional start flag
- UMM represents an existing banner, which matches the rerouter product story
- UMM is easier to exchange between banner tools than CSV
- UMM avoids the brittle CSV header and encoding workflow from the Telegram bot

### Validation rules

Reject the file with a user-facing error if any of these are true:

- file is not valid JSON
- top-level object is missing `missions`
- `missions` is not a non-empty array
- no portals can be extracted
- fewer unique portals exist than `missionCount * 6`

Warn but continue if:

- duplicate portals are found
- some portals are missing `guid` but have usable coordinates
- some portals are missing `imageUrl`
- some missions have unexpected extra fields

### Portal normalization

Normalize every imported portal into a shared `RerouterPortal` shape:

```ts
type RerouterPortal = {
  portalKey: string;
  guid: string | null;
  title: string;
  latitude: number;
  longitude: number;
  imageUrl: string | null;
  description: string;
  isImportedStartPoint: boolean;
  sourceMissionIndex: number;
  sourceStepIndex: number;
  sourceMissionTitle: string | null;
  sourceOrderIndex: number;
};
```

### Deduplication

Deduplicate using this priority:

1. exact `guid`
2. exact rounded coordinates at 6-7 decimals
3. same title plus near-identical coordinates within a tiny threshold

Keep the richest record when duplicates collide:

- prefer record with GUID
- then prefer record with image
- then prefer non-empty description

Record duplicate counts for the import summary UI.

## Data Model

Add a dedicated rerouter domain model in the client.

### Draft

```ts
type RerouterDraft = {
  id: string;
  createdAt: number;
  updatedAt: number;
  source: {
    importType: "umm";
    fileName: string;
    fileFormatVersion: number | null;
    importedAt: number;
  };
  metadata: {
    title: string;
    description: string;
    missionCount: number;
  };
  importedMissionSet: {
    missionSetName: string | null;
    missionSetDescription: string | null;
    titleFormat: string | null;
    plannedBannerLength: number | null;
    importedMissionCount: number;
  };
  portalPool: RerouterPortal[];
  excludedPortalKeys: string[];
  selectedStartPortalKey: string | null;
  routeOptions: RerouterRouteOptions;
  currentGeneratedRoute: RerouterGeneratedRoute | null;
  routeHistoryIds: string[];
};
```

### Route options

```ts
type RerouterRouteOptions = {
  targetStyle: "similar";
  optimizeFor: "balanced" | "compact" | "varied";
  preferLoopClosure: boolean;
  maxSingleHopMeters: number;
  nearRouteCaptureMeters: number;
  preserveImportedShapeBias: number;
};
```

Initial defaults should mirror the existing Python generator behavior while biasing toward the imported banner:

- `targetStyle = "similar"`
- `optimizeFor = "balanced"`
- `preferLoopClosure = true`
- `maxSingleHopMeters = 450`
- `nearRouteCaptureMeters = 30`
- `preserveImportedShapeBias = 0.5`

### Generated route

```ts
type RerouterGeneratedRoute = {
  id: string;
  createdAt: number;
  sourceDraftId: string;
  routeVersion: number;
  summary: {
    missionCount: number;
    portalsPerMission: 6;
    uniquePortalCount: number;
    estimatedLengthMeters: number;
    duplicateCountPrevented: number;
    excludedPortalCount: number;
  };
  orderedPortals: RerouterPortal[];
  missions: RerouterGeneratedMission[];
  mapViewportHint: {
    south: number;
    west: number;
    north: number;
    east: number;
  } | null;
  exportPayload: UMMMissionSet;
};
```

### Generated mission

```ts
type RerouterGeneratedMission = {
  missionIndex: number;
  missionTitle: string;
  missionDescription: string;
  portals: RerouterPortal[];
};
```

### History snapshot

History should store immutable reroute snapshots, not mutable draft references.

```ts
type RerouterRouteHistoryEntry = {
  id: string;
  draftId: string;
  createdAt: number;
  label: string;
  summary: RerouterGeneratedRoute["summary"];
  selectedStartPortalKey: string | null;
  excludedPortalKeys: string[];
  route: RerouterGeneratedRoute;
};
```

## Storage Design

### Recommendation

Use two layers:

1. `localStorage` for lightweight rerouter UI state
2. `IndexedDB` for full draft and history payloads

Both layers are browser-local only.

### Why not localStorage only

Route history can get large:

- imported UMM payload
- normalized portal pool
- exclusion state
- generated missions
- multiple history snapshots

This will exceed safe `localStorage` usage quickly and make serialization slow.

### Storage split

#### localStorage

Store:

- active draft id
- last-opened rerouter panel
- reroute generator preferences
- last-selected history entry id

#### IndexedDB

Store:

- drafts
- route history entries
- imported source file metadata
- exported route payloads

No rerouter-domain persistence should be written to any remote API.

### Storage API

Create a new module pair:

- `src/bannerRerouterStore.js`
- `src/bannerRerouterDb.js`

`bannerRerouterStore.js` should mirror the style of [`src/bannergressSync.js`](/home/michael/OpenBanners/src/bannergressSync.js):

- stable storage keys
- normalized read/write functions
- custom change events
- `useSyncExternalStore` subscription for lightweight app state

`bannerRerouterDb.js` should contain the async IndexedDB CRUD layer.

### Persistence rules

- importing a new UMM file creates a new draft
- changing excluded portals updates the draft in place
- each successful reroute generation creates a new immutable history entry
- restoring a history entry sets `currentGeneratedRoute` on the draft without deleting history
- deleting a draft deletes its history entries only if explicitly requested

## Routing Engine Design

### Goal

Generate a reroute that feels similar to the imported banner while respecting user exclusions:

- exact `missionCount * 6` unique active portals
- grouped into 6-portal missions
- route is spatially coherent
- route roughly closes back toward the start area
- avoid huge jumps
- can include near-route portals from the remaining active set
- preserve the imported banner’s general footprint and flow where practical

### Implementation strategy

Do not try to port the entire Python script line-for-line into React component code.

Instead:

1. Implement the rerouting engine as a pure computation module
2. Run it in a Web Worker
3. Keep inputs and outputs deterministic and serializable

The worker must run on the user's machine in the browser context. No remote routing API may be used as a fallback.

### New modules

- `src/bannerRerouter/routeGenerator.js`
- `src/bannerRerouter/routeWorker.js`
- `src/bannerRerouter/umm.js`
- `src/bannerRerouter/geometry.js`
- `src/bannerRerouter/history.js`

### Worker boundary

Main thread sends:

- normalized portal pool
- excluded portal keys
- selected start portal
- mission count
- route options
- imported reference ordering

Worker returns:

- ordered portal list
- route summary
- derived mission set
- debug stats

All inputs and outputs remain local browser objects and persisted local snapshots.

### Algorithm phases

#### Phase 1: normalize and index

- compute projected XY coordinates relative to import centroid or start portal
- compute portal density
- derive an imported reference sequence from original mission and step order
- filter out excluded portals before route building
- compute pairwise candidate neighbor lists lazily, not full NxN if avoidable

#### Phase 2: seed backbone

Build an initial coarse route from the start portal by selecting candidate portals that optimize:

- forward progress
- density
- turn smoothness
- bounded hop size
- route diversity
- proximity to the imported banner’s geographic path
- soft affinity to imported ordering

This is the closest conceptual match to the current Python “candidate route” stage, but adjusted for rerouting an existing banner rather than building from a raw candidate CSV.

#### Phase 3: augment with nearby active portals

For each backbone leg:

- find unused active portals within `nearRouteCaptureMeters`
- insert them where they minimally distort the route
- keep only unique portals

#### Phase 4: enforce exact portal count

Ensure the final route contains exactly:

- `missionCount * 6`

If too short:

- extend outward with nearest valid unused active portals
- prefer low-cost insertions and local detours

If too long:

- trim highest-cost inserted portals while preserving route quality, start consistency, and imported-shape similarity

#### Phase 5: mission partitioning

Split ordered portals into blocks of 6.

Mission titles should use:

- draft title
- mission index
- mission total

Example:

- `Night Gardens 01-12`
- `Night Gardens 02-12`

#### Phase 6: export materialization

Create a UMM mission-set JSON payload matching the existing Python exporter contract.

## Similar Reroute Definition

“Similar reroute” should mean the generated result preserves the characteristics of the imported banner after excluded portals are removed, not that it reproduces the original ordering exactly.

Success criteria:

- starts at the chosen start portal
- uses exact portal count from the active pool
- keeps route locally walkable
- avoids visually chaotic cross-map jumps
- stays in the same broad geographic footprint as the imported banner
- produces mission start markers that form a sensible sequence on the map
- total route length stays within a soft target derived from mission count

### Distance targets

Reuse the Python scaling model as the first design baseline:

- default 12 missions targets roughly 4.5-5.5 km
- scale proportionally with mission count

This logic already exists conceptually in [`banner_creator/routing.py`](/mnt/c/Users/Michael/PycharmProjects/BannerCreator/banner_creator/routing.py:66).

### Failure modes

If generation cannot produce a valid reroute:

- keep the previous reroute intact
- show a structured error
- explain likely causes:
  - not enough remaining active portals
  - start portal is too isolated after exclusions
  - route constraints are too strict
  - too many portals were removed for the requested mission count

### Determinism

Add an optional seed field to the reroute generator input.

For v1:

- generate a random seed for each run
- persist the seed in route history

This makes regeneration traceable and debuggable.

## Portal Exclusion UX

### Core behavior

The user must be able to remove imported portals from the rerouted banner before generation.

“Remove” in this product means:

- exclude from active reroute generation
- keep visible as part of the imported source banner context
- keep restorable with one action

It does not mean destructive deletion of the imported source data.

### Portal review panel

Add a dedicated panel that supports:

- search by portal name
- filter by active vs excluded
- mission-origin badge
- bulk exclude selected
- bulk restore selected
- single-portal exclude and restore

### Map behavior for exclusions

Render excluded portals differently:

- active portals: normal mission/portal styling
- excluded portals: faded, muted, or dashed styling

This lets the user understand what changed from the imported banner to the rerouted output.

### Validation rule after exclusions

If remaining active unique portals are fewer than `missionCount * 6`, the app must block generation and clearly explain why.

## UMM Export Design

### Export goal

Generated reroutes should export back to a UMM mission-set file that other tools can consume.

Export must be implemented as a purely local browser download, for example via `Blob` plus `URL.createObjectURL`, not via server round-tripping.

### Export payload shape

Match the current legacy Python exporter fields:

- `missionSetName`
- `missionSetDescription`
- `currentMission`
- `plannedBannerLength`
- `titleFormat`
- `fileFormatVersion`
- `missions[]`

Per mission:

- `missionTitle`
- `missionDescription`
- `portals[]`

Per portal:

- `description`
- `guid`
- `imageUrl`
- `isOrnamented`
- `isStartPoint`
- `location.latitude`
- `location.longitude`
- `title`
- `type`
- `objective.type`

### Import-export asymmetry

Important design point:

- imported UMM is treated as the source banner and rerouting workspace
- exported UMM is treated as the rerouted final mission set

The app should store both concepts explicitly and never assume the imported mission boundaries are still meaningful after rerouting.

## UI Design

### New components

- `src/components/BannerRerouterPage.jsx`
- `src/components/BannerRerouterImportPanel.jsx`
- `src/components/BannerRerouterImportedBannerPanel.jsx`
- `src/components/BannerRerouterPortalPoolPanel.jsx`
- `src/components/BannerRerouterStartPortalPicker.jsx`
- `src/components/BannerRerouterRouteControls.jsx`
- `src/components/BannerRerouterRouteHistory.jsx`
- `src/components/BannerRerouterSummaryCard.jsx`
- `src/components/BannerRerouterMap.jsx`

### Reuse opportunities

Reuse from existing app:

- `BannerMarkers` and `Mission` for map rendering
- MUI layout patterns from `BannerDetailsPage`
- route-aware full-height shell from `Home`

### Page behavior

#### Empty state

Show:

- explanation of Banner Rerouter
- drag-and-drop UMM import target
- `Choose UMM File` button
- short copy that explains the value proposition:
  - import an existing banner
  - remove portals you do not want
  - reroute locally

#### After import

Show:

- imported file name
- mission-set name
- total imported missions
- unique portal count
- active portal count
- excluded portal count
- duplicate portal count
- detected geographic bounds

#### After reroute generation

Show:

- rerouted route map
- generated mission count
- total active portals used
- estimated length
- export button
- route history list

### Start portal picker UX

Support:

- search by portal name
- sort by imported order by default
- optional sort by nearest to map center or densest cluster later
- selected start portal badge

Only active portals should be selectable as the reroute start portal.

### Route history UX

Each history item should show:

- timestamp
- start portal
- mission count
- active portal count used
- excluded portal count
- estimated length
- optional route label like `Reroute 3`

Actions:

- preview
- restore
- export
- delete

## Map Design

### Reuse

`BannerRerouterMap` should reuse the mission rendering approach from:

- [`src/components/BannerDetailsPage.jsx`](/home/michael/OpenBanners/src/components/BannerDetailsPage.jsx)
- [`src/components/BannerGuider.jsx`](/home/michael/OpenBanners/src/components/BannerGuider.jsx)

### What to render

Render:

- rerouted mission polylines
- first portal marker for each mission
- optional full step markers
- start portal emphasis
- excluded imported portals with muted styling

The route overlay data itself must always come from the locally imported draft and locally generated reroute.

If the standard OpenBanners basemap remains tile-based, that is a view-layer dependency only. The rerouter logic must not depend on remote map, geocoding, or routing data in order to function.

### Preview modes

Support two modes:

- `Rerouted mission starts`
- `Full rerouted steps`
- `Imported vs rerouted comparison`

Default to `Rerouted mission starts` to reduce clutter on large routes.

## Application Architecture

### Router

Add new route to [`src/App.jsx`](/home/michael/OpenBanners/src/App.jsx):

- `/rerouter`

Update [`src/components/Home.jsx`](/home/michael/OpenBanners/src/components/Home.jsx) only if needed for top-level navigation state. The rerouter itself should not be forced into the browse/search view stack.

### Recommended integration model

Prefer this approach:

- render `BannerRerouterPage` directly from `App.jsx`, similar to `BannerGuider`

Why:

- rerouter is a self-contained full-screen workflow
- it avoids overloading `Home` further
- it keeps rerouter state separate from browse/search state

## Networking Constraint

Banner Rerouter should be designed so that it can still generate, inspect, restore, and export routes even if the network is unavailable after the initial app load.

For the rerouter flow:

- do not fetch portal data from Bannergress
- do not call any route-optimization API
- do not require server validation before export

The imported UMM file is the source of truth for rerouter input data.

## State Ownership

### Component-local state

Keep only transient UI state local:

- current import drag-over state
- open dialogs
- current search text in the portal picker
- current active/excluded filter view
- selected history preview item

### Store state

Keep draft and history state in the rerouter store:

- active draft id
- current draft payload
- exclusion state
- current generated reroute
- route history list metadata
- storage loading state

### Worker state

Keep generation-progress state ephemeral:

- queued
- running
- completed
- failed
- cancelled

## Performance Design

### Why a worker is required

Reroute generation can become expensive with:

- hundreds of portals
- route scoring loops
- exclusion-aware insertions
- shape-preservation scoring
- history snapshots

Running that on the main thread will freeze the map and inputs.

Because reroute generation is local-only, performance work matters more than in a server-backed design. The worker implementation should therefore be treated as a requirement, not an optimization.

## Error Handling

### Import errors

User-facing error messages should distinguish:

- invalid JSON
- unsupported file shape
- no portals found
- insufficient unique portals for requested mission count

### Reroute errors

Show:

- a short title
- actionable explanation
- keep last valid generated reroute visible if available

### Storage errors

If IndexedDB fails:

- keep current in-memory draft usable
- show a warning that history persistence is unavailable
- do not fall back to remote persistence

## Testing Design

### Unit tests

Add focused tests for:

- UMM import normalization
- portal deduplication
- portal exclusion state transitions
- mission-count validation
- route partitioning into 6-portal missions
- UMM export materialization
- store normalization

Suggested files:

- `src/bannerRerouter/umm.test.js`
- `src/bannerRerouter/routeGenerator.test.js`
- `src/bannerRerouter/store.test.js`

### Component tests

Add tests in the existing `App.test.jsx` style for:

- `/rerouter` renders empty import state
- valid UMM import populates the imported banner summary
- excluding a portal updates active counts
- start portal picker filters by search text
- generate reroute stores history entry
- restoring history entry updates the current reroute

### Manual regression checks

Add a new section to `docs/regression-checklist.md` later for:

- import
- portal exclusion
- reroute generation
- history restore
- export

## Implementation Plan

### Phase 1: foundation

- add `/rerouter` route and empty page
- add rerouter store shell
- add IndexedDB shell
- add import panel UI

### Phase 2: UMM pipeline and portal review

- parse and validate UMM
- normalize and deduplicate portals
- create draft records
- show imported banner summary
- implement exclusion and restore flows

### Phase 3: reroute generation

- add worker
- implement initial reroute generator
- render generated reroute on map
- materialize generated missions

### Phase 4: history

- persist reroute snapshots
- restore reroute snapshots
- add history UI and deletion

### Phase 5: export

- export rerouted route as UMM JSON
- polish summary and error states
- add tests and regression checklist

## Open Questions

These need product decisions before implementation:

1. Should imported title and description automatically become the initial reroute metadata, or only if the fields are non-empty?
2. Should the imported `isStartPoint` flag preselect the start portal when present?
3. Should excluded portals remain visible on the map by default, or only when comparison mode is enabled?
4. Should route history be per draft only, or global across all rerouter drafts?
5. Should mission count default to the imported planned banner length even when exclusions later force the user to reduce it?

## Recommended Decisions

To keep the first implementation practical:

1. Use imported title and description as initial defaults.
2. Preselect the imported start portal if exactly one portal has `isStartPoint`.
3. Keep excluded portals visible in muted styling by default.
4. Keep route history per draft.
5. Default mission count to the imported banner length, but block generation until the remaining active portal count is sufficient or the user lowers the mission count.

## Summary

The cleanest OpenBanners-native version of this feature is:

- a new `/rerouter` route
- UMM import as the source banner and active portal pool
- explicit portal exclusion before reroute generation
- a local Web Worker reroute generator modeled after the current Python tool
- immutable reroute history stored in IndexedDB
- generated UMM export as the primary output

And all of that should run entirely on the user's local machine, with no rerouter-domain server round-trips.
