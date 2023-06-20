// src/components/SearchResults.js

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function SearchResults({ query }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchSearchResults = async () => {
    console.log("fetching search results");
    setLoading(true);
    try {
      const response = await fetch(
        `https://api.bannergress.com/places?used=true&collapsePlaces=true&query=${encodeURIComponent(
          query
        )}&limit=100&offset=0`
      );
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error("Error fetching search results:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = (id) => {
    navigate(`/browse/${id}`);
  };

  return (
    <div>
      {loading ? (
        <p>Loading...</p>
      ) : (
        results.map((result, index) => (
          <h3
            key={index}
            style={{ color: "white", cursor: "pointer" }}
            onClick={() => handleClick(result.id)}
          >
            {`${result.shortName} (${result.type}) (${result.numberOfBanners})`}
          </h3>
        ))
      )}
    </div>
  );
}
