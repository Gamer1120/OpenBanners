import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetInstallStateForTests,
  getInstallMode,
  isAndroidWebView,
  isIos,
  isRunningStandalone,
  promptInstall,
} from "./pwaInstall";

function setUserAgent(userAgent) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

describe("pwaInstall", () => {
  beforeEach(() => {
    __resetInstallStateForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.matchMedia;
    __resetInstallStateForTests();
  });

  it("uses the saved beforeinstallprompt event once", async () => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(getInstallMode()).toBe("prompt");
    await expect(promptInstall()).resolves.toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await expect(promptInstall()).resolves.toBe("unavailable");
  });

  it("hides the option once installed or running standalone", () => {
    window.dispatchEvent(new Event("appinstalled"));
    expect(getInstallMode()).toBe("installed");

    __resetInstallStateForTests();
    window.matchMedia = (query) => ({ matches: query === "(display-mode: standalone)" });
    expect(isRunningStandalone()).toBe(true);
    expect(getInstallMode()).toBe("installed");
  });

  it("picks instructions per browser", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
    expect(isIos()).toBe(true);
    expect(getInstallMode()).toBe("ios");

    vi.restoreAllMocks();
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0 Mobile Safari/537.36");
    expect(isAndroidWebView()).toBe(true);
    expect(getInstallMode()).toBe("webview");

    vi.restoreAllMocks();
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0");
    expect(getInstallMode()).toBe("manual");
  });
});
