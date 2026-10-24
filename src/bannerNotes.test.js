import { describe, expect, it } from "vitest";
import { accountOf, decryptNote, encryptNote, keyIdOf, newRawKey } from "./bannerNotes";

describe("banner notes encryption", () => {
  it("round-trips, and fails for another key, account or banner", async () => {
    const key = newRawKey();
    const sealed = await encryptNote(key, "acc", "b1", "Passphrase is café ☕");
    expect(sealed.data).not.toContain("caf");
    expect(await decryptNote(key, "acc", "b1", sealed)).toBe("Passphrase is café ☕");
    await expect(decryptNote(newRawKey(), "acc", "b1", sealed)).rejects.toThrow();
    await expect(decryptNote(key, "other", "b1", sealed)).rejects.toThrow();
    await expect(decryptNote(key, "acc", "b2", sealed)).rejects.toThrow();
  });

  it("fingerprints keys and reads the account from a token", async () => {
    const key = newRawKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await keyIdOf(key)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await keyIdOf(key)).toBe(await keyIdOf(key));
    const payload = btoa(JSON.stringify({ sub: "user-1" })).replace(/=+$/, "");
    expect(accountOf(`x.${payload}.y`)).toBe("user-1");
  });
});
