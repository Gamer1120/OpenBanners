import React, { useEffect, useState } from "react";

export default function SearchResults({ query }) {
  const [results, setResults] = useState([]);

  useEffect(() => {
    const fetchSearchResults = async () => {
      try {
        const response = await fetch(
          `https://api.bannergress.com/places?used=true&collapsePlaces=true&query=${encodeURIComponent(
            query
          )}&limit=100&offset=0`
        );
        const data = await response.json();
        setResults(data.results);
      } catch (error) {
        console.error("Error fetching search results:", error);
      }
    };

    fetchSearchResults();
  }, [query]);

  return (
    <div>
      {results.map((result) => (
        <div key={result.id}>
          {/* Display the relevant information from the search results */}
          <h3>{result.name}</h3>
          {/* Add more JSX code to display additional information */}
        </div>
      ))}
    </div>
  );
}
