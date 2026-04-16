import "./App.css";
import BannerGuider from "./components/BannerGuider";
import BannerGuiderWithoutLocation from "./components/BannerGuiderWithoutLocation";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { useLayoutEffect } from "react";
import Home from "./components/Home";

function ScrollToTopOnNavigation() {
  const location = useLocation();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname, location.search]);

  return null;
}

function App() {
  return (
    <div className="App">
      <Router>
        <ScrollToTopOnNavigation />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route exact path="/browse/" element={<Home />} />
          <Route exact path="/browse/:placeId" element={<Home />} />
          <Route path="/banner/:bannerId" element={<Home />} />
          <Route path="/agent/:agentName" element={<Home />} />
          <Route path="/bannerguider/:bannerId" element={<BannerGuider />} />
          <Route
            path="/bannerguiderwithoutlocation/:bannerId"
            element={<BannerGuiderWithoutLocation />}
          />
          <Route path="/search/:query" element={<Home />} />
          <Route path="/map" element={<Home />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
