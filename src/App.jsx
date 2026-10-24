import "./App.css";
import BannerGuider from "./components/BannerGuider";
import BannerGuiderWithoutLocation from "./components/BannerGuiderWithoutLocation";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { ScrollManager } from "./scrollRestoration";
import Home from "./components/Home";

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
      <Router>
        <ScrollManager />
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
        </Routes>
      </Router>
    </div>
  );
}

export default App;
