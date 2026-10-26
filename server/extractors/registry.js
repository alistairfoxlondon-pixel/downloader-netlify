import { AppError } from "../lib/errors.js";
import { parseHttpUrl } from "../lib/urlguard.js";

import * as streamtape from "./streamtape.js";
import * as vidara from "./vidara.js";
import * as firestream from "./firestream.js";
import * as playmate from "./playmate.js";
import * as lulustream from "./lulustream.js";
import * as streamfile from "./streamfile.js";
import * as direct from "./direct.js";

/**
 * Extraction registry — order matters: site-specific matchers first, the
 * generic direct-URL extractor is the fallback.
 */
export const extractors = [streamtape, vidara, firestream, playmate, lulustream, streamfile, direct];

export function siteList() {
  return extractors
    .filter((e) => e.id !== "direct")
    .map((e) => ({ id: e.id, label: e.label, hosts: e.hosts }));
}

export function matchExtractor(url) {
  return extractors.find((e) => e.match(url)) || direct;
}

/**
 * Validate user input and run the matching extractor.
 * @param {string} rawUrl
 * @returns {Promise<object>} normalized extraction result
 */
export async function extractFromUrl(rawUrl) {
  const url = parseHttpUrl(rawUrl);
  const extractor = matchExtractor(url);
  const started = Date.now();
  const result = await extractor.extract(url);
  return { ...result, site: result.site || extractor.id, extractorMs: Date.now() - started };
}
