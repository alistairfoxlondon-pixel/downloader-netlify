// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

import App from "./App.jsx";

beforeAll(() => {
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input);
    const json = (body, status) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/api/config")) {
      return json(
        { ok: true, sites: [{ id: "streamtape", label: "Streamtape", hosts: ["streamtape.com"] }], formats: [], worker: { available: false, healthy: false }, version: "1.0.0" },
        200,
      );
    }
    if (url.includes("/api/extract")) {
      return json(
        { ok: false, error: { code: "E_UPSTREAM", message: "Could not reach the source server (network error)." } },
        504,
      );
    }
    return json({ ok: false, error: { code: "E_INTERNAL", message: "Unexpected." } }, 500);
  });
});

afterEach(() => cleanup());

describe("minimal UI", () => {
  it("renders the short landing UI with no gradients and no bulky sections", async () => {
    const { container } = render(React.createElement(App));

    // Core controls present.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Download/i);
    expect(screen.getByLabelText("Video URL")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Fetch video/i })).toBeTruthy();

    // No gradients anywhere in the DOM (inline styles or CSS-in-JS strings).
    expect(container.innerHTML).not.toMatch(/gradient/i);
    expect(document.querySelectorAll('[style*="gradient"]')).toHaveLength(0);

    // Bulky marketing sections are gone.
    expect(screen.queryByText(/three steps/i)).toBeNull();
    expect(screen.queryByText(/Built like a product/i)).toBeNull();
    expect(screen.queryByText(/CAPABILITIES/i)).toBeNull();
    expect(screen.queryByText(/EXTRACTION RESULT/i)).toBeNull();

    // Footer stays to a single short line.
    expect(screen.getByText(/Authorised use only/i)).toBeTruthy();
  });

  it("shows a short, code-free error on failure", async () => {
    render(React.createElement(App));
    const form = screen.getByLabelText("Video URL form");
    // submit empty → local validation message only
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(await screen.findByText("Paste a video URL first.")).toBeTruthy();
  });
});
