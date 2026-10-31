import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EnlargeableArt, MissionMosaic } from "./shared";

const banner = { id: "b", width: 2 };
const missions = [
  { id: "m1", title: "One", picture: "https://example.com/1" },
  { id: "m2", title: "Two", picture: "https://example.com/2" },
];
const colors = ["#f00", "#0f0"];

test("tapping the banner artwork opens the viewer instead of opening a mission", async () => {
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
  const dialog = await screen.findByRole("dialog", { name: /banner artwork/i });
  expect(dialog).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  // Tapping the artwork itself doesn't close it (it's for zooming); tapping beside it does.
  await user.click(screen.getByRole("button", { name: /enlarge banner artwork/i }));
  await screen.findByRole("dialog");
  await user.click(document.querySelector(".bv-art .mosaic"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(document.querySelector(".bv-scroll"));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: /enlarge banner artwork/i }));
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("the viewer zooms with its buttons and can number the tiles", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <EnlargeableArt banner={banner} missions={missions} colors={colors}>
        <MissionMosaic banner={banner} missions={missions} colors={colors} />
      </EnlargeableArt>
    </MemoryRouter>
  );

  await user.click(screen.getByRole("button", { name: /enlarge banner artwork/i }));
  await screen.findByRole("dialog");
  const mosaic = () => document.querySelector(".bv-art .mosaic");
  await waitFor(() => expect(mosaic()).not.toBeNull());
  const size = () => parseFloat(mosaic().style.getPropertyValue("--t"));
  const start = size();
  expect(start).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(size()).toBeGreaterThan(start);
  await user.click(screen.getByRole("button", { name: "Zoom out" }));
  await user.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(size()).toBeLessThan(start + 0.01);

  const numbers = screen.getByRole("button", { name: "Show mission numbers" });
  expect(numbers).toHaveAttribute("aria-pressed", "false");
  await user.click(numbers);
  expect(numbers).toHaveAttribute("aria-pressed", "true");
  expect([...mosaic().querySelectorAll(".tile")].map((tile) => tile.dataset.n)).toEqual(["2", "1"]);
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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

test("the viewer's mosaic only loads the pictures of rows near the screen", () => {
  const tallBanner = { id: "t", width: 2 };
  const tallMissions = [0, 1, 2, 3, 4, 5].map((position) => ({ id: `m${position}`, picture: `https://example.com/${position}` }));
  const { container } = render(
    <MissionMosaic banner={tallBanner} missions={tallMissions} colors={[]} tile={50} rowRange={[1, 1]} />
  );

  // Rows from the top: [6, 5], [4, 3], [2, 1] in mission numbers; only the middle row has pictures.
  expect([...container.querySelectorAll(".tile")].map((tile) => Boolean(tile.querySelector("img")))).toEqual([
    false,
    false,
    true,
    true,
    false,
    false,
  ]);
  expect(container.querySelector(".mosaic").style.getPropertyValue("--t")).toBe("50px");
});
