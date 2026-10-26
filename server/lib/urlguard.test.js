import { describe, it, expect } from "vitest";
import { parseHttpUrl, isPrivateIp, isBlockedHostname, assertSafeUrl, assertSafeUrlWithDns } from "./urlguard.js";
import { AppError } from "./errors.js";

describe("parseHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(parseHttpUrl("https://example.com/a.mp4").href).toBe("https://example.com/a.mp4");
    expect(parseHttpUrl("http://example.com/").protocol).toBe("http:");
  });

  it("rejects empty, non-URL, non-http, credential and long inputs", () => {
    const bad = [
      "",
      "   ",
      "not a url",
      "ftp://example.com/x",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://user:pass@example.com/",
      "https://example.com:" + "9".repeat(40),
      "https://example.com/" + "a".repeat(3000),
    ];
    for (const input of bad) {
      expect(() => parseHttpUrl(input), input).toThrow(AppError);
    }
  });

  it("rejects non-standard ports", () => {
    expect(() => parseHttpUrl("https://example.com:8443/v")).toThrow(/port/i);
    expect(() => parseHttpUrl("http://example.com:8080/v")).toThrow(/port/i);
    expect(() => parseHttpUrl("https://example.com:443/v")).not.toThrow();
    expect(() => parseHttpUrl("http://example.com:80/v")).not.toThrow();
  });
});

describe("isPrivateIp", () => {
  const priv = ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "255.255.255.255", "::1", "fe80::1", "fc00::1", "fd12::1", "::ffff:192.168.0.1"];
  const pub = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "104.16.0.1", "2606:4700::1111"];
  it.each(priv)("flags %s as private", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(pub)("allows %s as public", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("isBlockedHostname", () => {
  it.each(["localhost", "foo.localhost", "printer.local", "db.internal", "metadata.google.internal", "foo.lan"])(
    "blocks %s",
    (h) => expect(isBlockedHostname(h)).toBe(true),
  );
  it.each(["example.com", "streamtape.com", "vidara.to"])("allows %s", (h) =>
    expect(isBlockedHostname(h)).toBe(false),
  );
});

describe("assertSafeUrl", () => {
  it("rejects literal private IPs", () => {
    expect(() => assertSafeUrl("http://127.0.0.1/steal")).toThrow(AppError);
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data")).toThrow(AppError);
    expect(() => assertSafeUrl("http://[::1]/")).toThrow(AppError);
  });
  it("allows public IP literals", () => {
    expect(() => assertSafeUrl("https://8.8.8.8/video.mp4")).not.toThrow();
  });
});

describe("assertSafeUrlWithDns", () => {
  it("rejects localhost hostnames after DNS resolution", async () => {
    await expect(assertSafeUrlWithDns("http://localhost:80/")).rejects.toThrow(AppError);
  });
  it("resolves a public hostname (live DNS)", async () => {
    // Uses the real resolver — available both locally and in CI.
    const url = await assertSafeUrlWithDns("https://example.com/");
    expect(url.hostname).toBe("example.com");
  }, 15000);
});
