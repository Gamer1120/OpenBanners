import React, { useEffect, useState } from "react";
import { Search } from "@mui/icons-material";
import { useNavigate, useParams } from "react-router-dom";

export default function SearchForm({
  big = false,
  className = "",
  placeholder = "Search banners or places",
  onSearch,
}) {
  const { query } = useParams();
  const navigate = useNavigate();
  const [value, setValue] = useState(typeof query === "string" ? query : "");

  useEffect(() => {
    setValue(typeof query === "string" ? query : "");
  }, [query]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmedValue = value.trim();

    if (trimmedValue === "") {
      return;
    }

    if (typeof onSearch === "function") {
      onSearch(trimmedValue);
      return;
    }

    navigate(`/search/${encodeURIComponent(trimmedValue)}`);
  };

  return (
    <form
      className={`searchbar${big ? " big" : ""} ${className}`.trim()}
      role="search"
      aria-label="Search banners and places"
      onSubmit={handleSubmit}
    >
      <input
        type="search"
        placeholder={placeholder}
        aria-label="Search query"
        value={value}
        enterKeyHint="search"
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="icon-btn sl" aria-label="Submit search">
        <Search />
      </button>
    </form>
  );
}
