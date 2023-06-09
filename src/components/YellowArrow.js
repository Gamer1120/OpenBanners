import React from "react";

const YellowArrow = ({ direction }) => {
  const arrowStyle = {
    position: "absolute",
    top: "10px",
    left: "50%",
    transform: "translateX(-50%) rotate(180deg)", // Added rotate(180deg) to flip the arrow
    zIndex: "1000",
  };

  return (
    <div style={arrowStyle}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
      >
        <path
          fill="none"
          stroke="#F8C60B"
          strokeWidth="2" // Changed stroke-width to strokeWidth
          d="M12 22L1 11h7V2h8v9h7z"
        />
      </svg>
    </div>
  );
};

export default YellowArrow;
