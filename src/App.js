import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./components/Home";
import CountryPage from "./components/CountryPage";

function App() {
  return (
    <div className="App">
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse/*" element={<Home />} />
          <Route path="/browse/:countryId" element={<Home />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
