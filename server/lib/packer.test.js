import { describe, it, expect } from "vitest";
import { unpackScripts, unpackPayload, unescapePct, expandFromCharCodes } from "./packer.js";

describe("unescapePct", () => {
  it("decodes %XX and %uXXXX like JS unescape()", () => {
    expect(unescapePct("%3Cscript%3E")).toBe("<script>");
    expect(unescapePct("a%u0041b")).toBe("aAb");
  });
});

describe("unpackPayload", () => {
  it("substitutes base-62 dictionary tokens with word boundaries", () => {
    // percent-encoded "\n0='1','2';"  tokens 0=alpha 1=beta 2=gamma
    const payload = "%0A0%3D%271%27%2C%272%27%3B";
    const out = unpackPayload(payload, 62, ["alpha", "beta", "gamma"]);
    expect(out).toBe("\nalpha='beta','gamma';");
  });

  it("does not substitute digits embedded in longer words", () => {
    const out = unpackPayload("x10 + 1", 62, ["ONLY"]);
    expect(out).toBe("x10 + 1");
  });
});

describe("unpackScripts", () => {
  it("unpacks a full eval(function(p,a,c,k,e,d){…}(...)) script block", () => {
    // Packed form of: "\nvar plyrHlsSrc='https://cdn.example.com/master.m3u8';"
    // Dictionary: 0=var, 1=plyrHlsSrc, 2=https://cdn.example.com/master.m3u8
    const dictStr = ["var", "plyrHlsSrc", "https://cdn.example.com/master.m3u8"].join("|");
    const body = "%0A0%201%3D%272%27%3B";
    const script =
      `eval(function(p,a,c,k,e,r){e=function(c){return c};for(var i=0;i<c.length;i++)k=c[i];return p}` +
      `('${body}',62,3,'${dictStr}'.split('|'),0,{}))`;
    const html = `<html><script>${script}</script></html>`;
    const out = unpackScripts(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("plyrHlsSrc");
    expect(out[0]).toContain("https://cdn.example.com/master.m3u8");
  });

  it("handles double-quoted payloads", () => {
    const dictStr = ["https://x/y.mp4"].join("|");
    const script = `eval(function(p,a,c,k,e,d){return p}("%73%72%63%3D%220%22",62,1,"${dictStr}".split("|"),0,{}))`;
    const out = unpackScripts(`<script>${script}</script>`);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("https://x/y.mp4");
  });

  it("ignores plain scripts without packer structure", () => {
    expect(unpackScripts("<script>console.log(1)</script>")).toEqual([]);
  });
});

describe("expandFromCharCodes", () => {
  it("expands String.fromCharCode runs", () => {
    expect(expandFromCharCodes("x=String.fromCharCode(104,116,116,112)")).toBe("x=http");
    expect(expandFromCharCodes("String.fromCharCode(0x61,0x62)")).toBe("ab");
  });
  it("leaves unknown patterns untouched", () => {
    expect(expandFromCharCodes("no calls here")).toBe("no calls here");
  });
});
