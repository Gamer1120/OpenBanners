import React from "react";

const YellowArrow = ({ direction }) => {
  const arrowStyle = {
    position: "absolute",
    top: "10px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "1000",
  };

  return (
    <div style={arrowStyle}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="32"
        height="32"
        viewBox="0 0 32 32"
      >
        <path
          fill="transparent"
          d="M15.94 5.28l-11.3 12.2 2.84 2.92 5.46-5.5v17.1h3v-17.07l5.45 5.48 2.84-2.9z"
        />
        <path fill="yellow" d="M16 2l-16 16h9v14h14v-14h9z" />
      </svg>
    </div>
  );
};

export default YellowArrow;
