import { describe, expect, it, vi } from "vitest";
import { buildOverlayReturnLinks, downloadMyData, formatLocalTime, parseOverlayConnect } from "./accountData";

vi.mock("./passphraseApi", () => ({
  call: vi.fn(async (path, options) => ({ path, options, exportedAt: "2026-10-31T12:00:00.000Z", dataExports: { nextExportAt: "2026-10-31T13:00:00.000Z" } })),
}));

const CHALLENGE = "a".repeat(43);

describe("account data", () => {
  it("accepts only complete Overlay connect links", () => {
    expect(parseOverlayConnect(`?action=backup&challenge=${CHALLENGE}&state=abcdefghijklmnop`)).toEqual({ action: "backup", challenge: CHALLENGE, state: "abcdefghijklmnop" });
    expect(parseOverlayConnect(`?action=restore&challenge=${CHALLENGE}&state=abcdefghijklmnop`)?.action).toBe("restore");
    expect(parseOverlayConnect(`?action=delete&challenge=${CHALLENGE}&state=abcdefghijklmnop`)).toBeNull();
    expect(parseOverlayConnect(`?action=backup&challenge=short&state=abcdefghijklmnop`)).toBeNull();
    expect(parseOverlayConnect(`?action=backup&challenge=${CHALLENGE}&state=x`)).toBeNull();
    expect(parseOverlayConnect("")).toBeNull();
  });

  it("hands only the one-time code and state back to the app; the fallback has no code", () => {
    const { link, intent } = buildOverlayReturnLinks({ code: "CODE123", state: "STATE456", origin: "https://openbanners.org", search: `?action=backup&challenge=${CHALLENGE}&state=STATE456` });
    expect(link).toBe("openbanners-overlay://link?code=CODE123&state=STATE456");
    expect(intent).toMatch(/^intent:\/\/link\?code=CODE123&state=STATE456#Intent;scheme=openbanners-overlay;package=org\.openbanners\.overlay;S\.browser_fallback_url=/);
    const fallback = decodeURIComponent(intent.split("S.browser_fallback_url=")[1].replace(/;end$/, ""));
    expect(fallback).toContain("https://openbanners.org/overlay/connect?");
    expect(fallback).toContain("overlay=missing");
    expect(fallback).not.toContain("CODE123");
  });

  it("saves the export as a dated JSON file", async () => {
    const clicks = [];
    const created = [];
    const win = {
      URL: { createObjectURL: (blob) => (created.push(blob), "blob:x"), revokeObjectURL: vi.fn() },
      document: { body: { appendChild: vi.fn() }, createElement: () => ({ click() { clicks.push(this.download); }, remove: vi.fn() }) },
      setTimeout: vi.fn(),
    };
    const result = await downloadMyData({ win });
    expect(clicks).toEqual(["openbanners-data-2026-10-31.json"]);
    expect(created[0].type).toBe("application/json");
    expect(result.nextExportAt).toBe("2026-10-31T13:00:00.000Z");
  });

  it("formats the next time in local time, with the date when it isn't today", () => {
    const now = new Date(2026, 9, 31, 12, 0);
    expect(formatLocalTime(new Date(2026, 9, 31, 13, 5).toISOString(), now)).toMatch(/13:05|1:05/);
    expect(formatLocalTime(new Date(2026, 10, 1, 0, 30).toISOString(), now)).toMatch(/Nov|2026/);
    expect(formatLocalTime("nonsense", now)).toBe("");
  });
});
