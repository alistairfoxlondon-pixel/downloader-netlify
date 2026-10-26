import { describe, it, expect, afterEach } from "vitest";
import { signMediaToken, verifyMediaToken } from "./sign.js";
import { AppError } from "./errors.js";

describe("media capability tokens", () => {
  afterEach(() => {
    delete process.env.MEDIA_SIGNING_SECRET;
  });

  it("round-trips a signed payload", async () => {
    const t = signMediaToken({
      url: "https://cdn.example.com/v.mp4",
      mode: "proxy",
      name: "My Video.mp4",
      ref: "https://example.com/page",
      ttl: 300,
    });
    const v = await verifyMediaToken(t);
    expect(v.url).toBe("https://cdn.example.com/v.mp4");
    expect(v.mode).toBe("proxy");
    expect(v.name).toBe("My Video.mp4");
    expect(v.ref).toBe("https://example.com/page");
    expect(v.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects tampered payloads (URL swap)", async () => {
    const t = signMediaToken({ url: "https://cdn.example.com/v.mp4", mode: "auto" });
    const [payload, sig] = t.split(".");
    const evil = Buffer.from(JSON.stringify({ u: "http://169.254.169.254/", m: "proxy", n: "", r: "", e: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
    await expect(verifyMediaToken(`${evil}.${sig}`)).rejects.toThrow(AppError);
    expect(payload).not.toBe(evil);
  });

  it("rejects forged signatures", async () => {
    const t = signMediaToken({ url: "https://cdn.example.com/v.mp4" });
    const [payload] = t.split(".");
    await expect(verifyMediaToken(`${payload}.AAAAforgedAAAA`)).rejects.toThrow(/signature/i);
  });

  it("rejects expired tokens", async () => {
    const t = signMediaToken({ url: "https://cdn.example.com/v.mp4", ttl: -10 });
    await expect(verifyMediaToken(t)).rejects.toThrow(/expired/i);
  });

  it("honours a custom signing secret", async () => {
    process.env.MEDIA_SIGNING_SECRET = "unit-test-secret";
    const t = signMediaToken({ url: "https://cdn.example.com/v.mp4" });
    await expect(verifyMediaToken(t)).resolves.toBeTruthy();
    delete process.env.MEDIA_SIGNING_SECRET;
    await expect(verifyMediaToken(t)).rejects.toThrow(AppError);
  });
});
