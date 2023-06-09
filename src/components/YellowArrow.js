import React from "react";

const YellowArrow = ({ direction }) => {
  const arrowStyle = {
    position: "absolute",
    top: "10px",
    left: "50%",
    transform: `translateX(-50%) rotate(${direction}deg)`, // Apply rotation based on the direction
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
        <g transform="rotate(180 12 12)">
          {/* Added a group element with rotation */}
          <path
            fill="none"
            stroke="#F8C60B"
            strokeWidth="2"
            d="M12 22L1 11h7V2h8v9h7z"
          />
        </g>
      </svg>
    </div>
  );
};

export default YellowArrow;
