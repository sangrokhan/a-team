import { describe, it, expect } from "vitest";
import { AuthStore } from "../src/auth.js";

describe("AuthStore", () => {
  it("issues a session for the right password and validates it", () => {
    const auth = new AuthStore("s3cret");
    const sid = auth.login("s3cret");
    expect(sid).toBeTruthy();
    expect(auth.valid(sid!)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const auth = new AuthStore("s3cret");
    expect(auth.login("nope")).toBeNull();
  });

  it("invalidates a session on logout", () => {
    const auth = new AuthStore("s3cret");
    const sid = auth.login("s3cret")!;
    auth.logout(sid);
    expect(auth.valid(sid)).toBe(false);
  });
});
