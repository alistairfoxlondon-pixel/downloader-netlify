/**
 * Static (eval-free) unpackers for obfuscated player scripts.
 *
 * We never execute source-site JavaScript: everything is decoded with regex +
 * deterministic string substitution. This keeps the extraction path safe on a
 * multi-tenant serverless host (no process.env, no filesystem, no network
 * reachable from attacker-controlled markup).
 */

const PACKER_RE =
  /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:r|d)\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\5)[^\\])*)\5\s*\.split\s*\(\s*(['"])\|(\7)\s*\)\s*,\s*\d+\s*,\s*\{[^}]*\}\s*\)\s*\)/g;

/**
 * Decode %XX / %uXXXX escapes the way JS `unescape()` does.
 * @param {string} s
 */
export function unescapePct(s) {
  return s.replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, (m, u16, hex) => {
    if (u16) return String.fromCharCode(parseInt(u16, 16));
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * Encode a dictionary index the way the packer writes it: standard JS
 * toString() for bases 2–36, and the packer's 0-9a-zA-Z alphabet for 37–62
 * (JS Number.prototype.toString rejects radix > 36).
 */
function encodeToken(n, base) {
  if (base <= 36) return n.toString(base);
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (base > alphabet.length) return null;
  let out = "";
  let v = n;
  do {
    out = alphabet[v % base] + out;
    v = Math.floor(v / base);
  } while (v > 0);
  return out;
}

/**
 * Decode a numeric token written in the given base (the packer's `a` argument),
 * e.g. base 62 -> [0-9a-z].
 */
function decodeToken(token, base) {
  let n = 0;
  for (const ch of token) {
    let digit;
    if (ch >= "0" && ch <= "9") digit = ch.charCodeAt(0) - 48;
    else if (ch >= "a" && ch <= "z") digit = ch.charCodeAt(0) - 87;
    else if (ch >= "A" && ch <= "Z") digit = ch.charCodeAt(0) - 29; // base>52 only
    else return null;
    if (digit >= base) return null;
    n = n * base + digit;
  }
  return n;
}

/**
 * Unpack a single Dean-Edwards-style packed payload.
 * @param {string} payload escaped packed source (2nd packer argument)
 * @param {number} base    packer `a` argument
 * @param {string[]} dict  packer `k` (already split on `|`)
 * @returns {string} unpacked source
 */
export function unpackPayload(payload, base, dict) {
  let src = unescapePct(payload);
  const tokens = new Set();
  // Dictionary entries are referenced as base-`a` numbers bounded by word
  // boundaries. Collect plausible tokens once, longest first to avoid
  // partial replacements.
  for (let i = 0; i < dict.length; i++) {
    if (!dict[i]) continue;
    const tok = encodeToken(i, base);
    if (tok) tokens.add(tok);
  }
  const sorted = [...tokens].sort((x, y) => y.length - x.length);
  for (const tok of sorted) {
    const idx = decodeToken(tok, base);
    const replacement = idx !== null && idx < dict.length && dict[idx] ? dict[idx] : tok;
    const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    src = src.replace(re, replacement);
  }
  return src;
}

/**
 * Find packed scripts in HTML and return their unpacked sources.
 * Unpacking failures are skipped silently (the caller tries other strategies).
 * @param {string} html
 * @returns {string[]} unpacked script sources
 */
export function unpackScripts(html) {
  const out = [];
  const src = String(html);
  PACKER_RE.lastIndex = 0;
  let m;
  while ((m = PACKER_RE.exec(src))) {
    try {
      const payload = m[2];
      const base = Number(m[3]);
      const dictRaw = m[6];
      // The packer always calls `.split('|')`; groups 7/8 hold the quotes.
      const dict = dictRaw.split("|");
      const unpacked = unpackPayload(payload, base, dict);
      if (unpacked && unpacked.length > 0) out.push(unpacked);
    } catch {
      /* try next */
    }
  }
  return out;
}

/**
 * Expand `String.fromCharCode(104,116,116,112...)` runs that appear in
 * lightweight obfuscations.
 * @param {string} s
 */
export function expandFromCharCodes(s) {
  return String(s).replace(
    /String\.fromCharCode\(([\d\s,xu]+)\)/g,
    (whole, inner) => {
      try {
        const parts = inner.split(",").map((p) => p.trim()).filter(Boolean);
        const chars = parts.map((p) => {
          if (p.startsWith("0x") || p.startsWith("0X")) return String.fromCharCode(parseInt(p, 16));
          if (/^\d+$/.test(p)) return String.fromCharCode(Number(p));
          return "";
        });
        return chars.every((c) => c !== "") ? chars.join("") : whole;
      } catch {
        return whole;
      }
    },
  );
}
