import Mission from "./Mission";

export default function BannerMarkers({ missions, currentMission }) {
  const missionCount = missions.length;
  const rainbowColors = generateRainbowColors(missionCount);

  return (
    <div>
      {missions.map((mission, index) => {
        if (
          !currentMission ||
          currentMission === 0 ||
          index === currentMission ||
          index + 1 === currentMission ||
          currentMission === missionCount
        ) {
          const color = rainbowColors[index];
          return (
            <Mission
              key={mission.id}
              mission={mission}
              missionNumber={index + 1}
              color={color}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

function generateRainbowColors(count) {
  const colors = [];
  const increment = 360 / count;

  for (let i = 0; i < count; i++) {
    const hue = (i * increment) % 360;
    const color = `hsl(${hue}, 100%, 50%)`;
    colors.push(color);
  }

  return colors;
}
