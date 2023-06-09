import React from "react";

const YellowArrow = ({ direction }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="40"
      height="40"
      viewBox="0 0 40 40"
    >
      <path
        d="M20 2L1 17h9v16h12V17h9z"
        fill="#FDD017"
        transform={`rotate(${direction} 20 20)`}
      />
      <circle cx="20" cy="20" r="3" fill="#000" />
    </svg>
  );
};

export default YellowArrow;
