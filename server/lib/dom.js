/**
 * Tiny HTML helpers — no full DOM parser needed for the extraction patterns
 * we rely on, and zero dependency footprint for the Netlify bundle.
 */

const SCRIPT_BLOCK_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** Decode the handful of named entities that show up in titles/attrs. */
export function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/**
 * Extract all <script> blocks.
 * @param {string} html
 * @returns {Array<{attrs: string, body: string, id: string|null, src: string|null}>}
 */
export function scriptBlocks(html) {
  const out = [];
  let m;
  SCRIPT_BLOCK_RE.lastIndex = 0;
  while ((m = SCRIPT_BLOCK_RE.exec(html))) {
    const attrs = m[1] || "";
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    out.push({ attrs, body: m[2] || "", id: idMatch ? idMatch[1] : null, src: srcMatch ? srcMatch[1] : null });
  }
  return out;
}

/** Body of the script with the given id, or null. */
export function scriptById(html, id) {
  return scriptBlocks(html).find((s) => s.id === id)?.body ?? null;
}

/** First <title> text (entity-decoded, trimmed). */
export function pageTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const text = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return text || null;
}

/** First <meta property="og:image"|"og:title"|content> style value. */
export function ogMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${prop}["'][^>]*content\\s*=\\s*["']([^"']+)["']|<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${prop}["']`,
    "i",
  );
  const m = re.exec(html);
  return m ? decodeEntities(m[1] || m[2]) : null;
}

/** First <h1> text. */
export function firstH1(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return null;
  const text = decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return text || null;
}

/** Remove comments — some sites hide player config inside HTML comments. */
export function stripComments(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, "");
}
