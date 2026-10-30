import "./App.css";
import { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { ScrollManager } from "./scrollRestoration";
import Home from "./components/Home";
import ErrorBoundary from "./components/ErrorBoundary";

// Full-screen map pages: their own chunks (Leaflet), see Home.jsx.
const BannerGuider = lazy(() => import("./components/BannerGuider"));
const BannerGuiderWithoutLocation = lazy(() => import("./components/BannerGuiderWithoutLocation"));

// Banner Together lives under Lists now; old (and shared invite) links keep
// working, including the invite secret in the hash.
function TogetherRedirect() {
  const location = useLocation();

  return (
    <Navigate
      replace
      to={{
        pathname: `/lists${location.pathname}`,
        search: location.search,
        hash: location.hash,
      }}
    />
  );
}

function App() {
  return (
    <div className="App">
      <ErrorBoundary>
      <Router>
        <ScrollManager />
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route exact path="/browse/" element={<Home />} />
          <Route exact path="/browse/:placeId" element={<Home />} />
          <Route path="/banner/:bannerId" element={<Home />} />
          <Route path="/together/:placeId/live/:roomId" element={<TogetherRedirect />} />
          <Route path="/together/:placeId" element={<TogetherRedirect />} />
          <Route path="/agent/:agentName" element={<Home />} />
          <Route path="/rerouter" element={<Home />} />
          <Route path="/planner" element={<Home />} />
          <Route path="/planner/:planId" element={<Home />} />
          <Route path="/translate" element={<Home />} />
          <Route path="/privacy" element={<Home />} />
          <Route
            path="/bannerguider/:bannerId/debug"
            element={<BannerGuider />}
          />
          <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
          <Route
            path="/bannerguiderwithoutlocation/:bannerId"
            element={<BannerGuiderWithoutLocation />}
          />
          <Route path="/search" element={<Home />} />
          <Route path="/search/:query" element={<Home />} />
          <Route path="/near" element={<Home />} />
          <Route path="/map" element={<Home />} />
          <Route path="/lists" element={<Home />} />
          <Route path="/lists/together" element={<Home />} />
          <Route path="/lists/together/:placeId" element={<Home />} />
          <Route path="/lists/together/:placeId/live/:roomId" element={<Home />} />
          {/* Anything else: "Page not found" in the normal layout (the
              server sends it with status 404). */}
          <Route path="*" element={<Home notFound />} />
        </Routes>
        </Suspense>
      </Router>
      </ErrorBoundary>
    </div>
  );
}

export default App;
