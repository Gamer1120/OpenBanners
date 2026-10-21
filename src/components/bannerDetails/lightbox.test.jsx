import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EnlargeableArt, MissionMosaic } from "./shared";

const banner = { id: "b", width: 2 };
const missions = [
  { id: "m1", title: "One", picture: "https://example.com/1" },
  { id: "m2", title: "Two", picture: "https://example.com/2" },
];
const colors = ["#f00", "#0f0"];

test("tapping the banner artwork enlarges it instead of opening a mission", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <EnlargeableArt banner={banner} missions={missions} colors={colors}>
        <MissionMosaic banner={banner} missions={missions} colors={colors} />
      </EnlargeableArt>
    </MemoryRouter>
  );

  expect(screen.queryByRole("button", { name: /mission 1/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /enlarge banner artwork/i }));
  expect(screen.getByRole("dialog", { name: /banner artwork/i })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
