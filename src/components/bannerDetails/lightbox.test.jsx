import { render, screen, within } from "@testing-library/react";
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

  // Tapping the enlarged artwork closes it (and doesn't reopen it).
  await user.click(screen.getByRole("button", { name: /enlarge banner artwork/i }));
  await user.click(within(screen.getByRole("dialog")).getByRole("img"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /enlarge banner artwork/i }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// Tiles of the mosaic from top-left: mission id, "gap" (filler slot) or "void" (padding).
function mosaicCells(container) {
  return [...container.querySelector(".mosaic").children].map((cell) =>
    cell.classList.contains("gap")
      ? "gap"
      : cell.classList.contains("void")
      ? "void"
      : cell.querySelector("img").getAttribute("src").replace("https://example.com/", "").replace(/=s\d+$/, "")
  );
}

test("a filler slot stays an empty tile in its place, like on Bannergress", () => {
  // 广式双马尾-f8aa: width 6, positions 0, 2, 3, 4, 5 (position 1 is another banner's mission).
  const gapBanner = { id: "g", width: 6 };
  const gapMissions = ["0", "2", "3", "4", "5"].map((position) => ({
    id: `m${position}`,
    picture: `https://example.com/${position}`,
  }));
  const { container } = render(
    <MissionMosaic banner={gapBanner} missions={gapMissions} slots={[0, 2, 3, 4, 5]} colors={[]} />
  );

  // Mission 1 bottom-right; the gap is second from the right, as in Bannergress' picture.
  expect(mosaicCells(container)).toEqual(["5", "4", "3", "2", "gap", "0"]);
  expect(container.querySelector(".mosaic").style.getPropertyValue("--rows")).toBe("1");
});

test("a filler slot can push the banner to another row", () => {
  const gapBanner = { id: "g", width: 3 };
  const gapMissions = [0, 1, 3].map((position) => ({ id: `m${position}`, picture: `https://example.com/${position}` }));
  const { container } = render(
    <MissionMosaic banner={gapBanner} missions={gapMissions} slots={[0, 1, 3]} colors={[]} />
  );

  expect(mosaicCells(container)).toEqual(["void", "void", "3", "gap", "1", "0"]);
});

test("without filler slots the mosaic is unchanged", () => {
  const plainBanner = { id: "p", width: 3 };
  const plainMissions = [0, 1, 2, 3].map((position) => ({ id: `m${position}`, picture: `https://example.com/${position}` }));
  const withSlots = render(
    <MissionMosaic banner={plainBanner} missions={plainMissions} slots={[0, 1, 2, 3]} colors={[]} />
  );
  expect(mosaicCells(withSlots.container)).toEqual(["void", "void", "3", "2", "1", "0"]);
  withSlots.unmount();
  const withoutSlots = render(<MissionMosaic banner={plainBanner} missions={plainMissions} colors={[]} />);
  expect(mosaicCells(withoutSlots.container)).toEqual(["void", "void", "3", "2", "1", "0"]);
});
