/**
 * The "no AI slop" rules from SPEC.md section 11 and the brief's design section, as checks.
 * A line can opt out of one rule with a trailing comment `cliche-lint-allow: <rule> (<reason>)`.
 */

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|css|mdx|html|svg)$/;
const UI_COPY = /\.(tsx|jsx|mdx|html)$/;
const isTest = (path) => /\.test\.|\.spec\.|\/e2e/.test(path);

/** Named CSS colours that would bypass the token palette. */
const NAMED_COLOURS =
  "purple|violet|indigo|fuchsia|magenta|orchid|plum|lavender|thistle|mediumpurple|blueviolet|darkviolet|rebeccapurple|red|crimson|tomato|orange|gold|yellow|lime|green|teal|cyan|aqua|turquoise|blue|navy|royalblue|dodgerblue|deepskyblue|skyblue|pink|hotpink|salmon|coral|white|black|gray|grey|silver";
const NAMED_COLOUR_VALUE = new RegExp(
  `(?:color|background|fill|stroke|border(?:-color)?)\\s*:\\s*["']?(?:${NAMED_COLOURS})\\b|-\\[(?:${NAMED_COLOURS})\\]`,
  "i",
);

/** Fragment links such as href="#add" look like hex colours; they are not. */
const withoutFragmentLinks = (line) => line.replace(/\b(href|id|to)=["']#[\w-]*["']/g, "");

export const RULES = [
  {
    id: "purple-gradient",
    message: "purple or blue-to-purple gradients",
    applies: (path) => SOURCE.test(path),
    test: (line) =>
      /(linear|radial|conic)-gradient|bg-(gradient|linear|radial|conic)-/.test(line) &&
      /purple|violet|indigo|fuchsia|magenta|orchid|plum|lavender/i.test(line),
  },
  {
    id: "default-palette",
    message: "Tailwind default palette colours (use the Paper and Ink tokens)",
    applies: (path) => SOURCE.test(path),
    test: (line) =>
      /\b(?:bg|text|border|from|via|to|ring|fill|stroke|outline|decoration|shadow|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(
        line,
      ),
  },
  {
    id: "raw-colour",
    message:
      "raw or named colour values outside the token source (packages/ui/src/tokens/tokens.ts)",
    applies: (path) =>
      SOURCE.test(path) &&
      !isTest(path) &&
      !path.endsWith("packages/ui/src/tokens/tokens.ts") &&
      !path.endsWith("packages/ui/src/styles/tokens.css"),
    test: (raw) => {
      const line = withoutFragmentLinks(raw);
      return (
        /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?!-)/.test(line) ||
        /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*\d/.test(line) ||
        NAMED_COLOUR_VALUE.test(line)
      );
    },
  },
  {
    id: "glass",
    message: "glassmorphism (backdrop blur)",
    applies: (path) => SOURCE.test(path),
    test: (line) => /backdrop-filter|backdropFilter|backdrop-blur|\bglass(morphism)?\b/i.test(line),
  },
  {
    id: "emoji",
    message: "emoji in UI code or copy",
    applies: (path) => SOURCE.test(path),
    // Extended_Pictographic also covers text symbols such as the copyright sign; those are fine.
    test: (line) => /(?![©®™←-⇿])\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u.test(line),
  },
  {
    id: "inter-font",
    message: "Inter as a typeface",
    applies: (path) => SOURCE.test(path),
    test: (line) =>
      /font-family[^;]*\bInter\b|["']Inter( Variable)?["']|\bfont-inter\b|@fontsource(-variable)?\/inter\b|import\s*\{[^}]*\bInter\b[^}]*\}\s*from\s*["']next\/font|\bInter\(\s*\{/.test(
        line,
      ),
  },
  {
    id: "hype-copy",
    message: "generic hype copy such as 'Unlock your potential'",
    applies: (path) => UI_COPY.test(path),
    test: (line) =>
      /unlock your (full )?potential|supercharge your|level up your learning/i.test(line),
  },
  {
    id: "sparkle",
    message: "sparkle 'AI' icons",
    applies: (path) => SOURCE.test(path),
    test: (line) => /sparkle/i.test(line),
  },
  {
    id: "text-shadow",
    message: "drop shadows on text",
    applies: (path) => SOURCE.test(path),
    // The theme line that switches text shadows off (--text-shadow-*: initial) is fine.
    test: (line) => /(?<![-\w])text-shadow|\btextShadow\b/.test(line),
  },
  {
    id: "glow",
    message: "shadows other than the single shadow-raised token (neon glows, soft drop shadows)",
    applies: (path) => SOURCE.test(path) && !path.endsWith("packages/ui/src/styles/tokens.css"),
    test: (line) =>
      /\b(?:drop-)?shadow-(?!raised\b|none\b|\*)[\w[(]/.test(line) ||
      /box-shadow\s*:|\bboxShadow\b|drop-shadow\(/.test(line),
  },
  {
    id: "pill",
    message: "pill shapes outside toggles",
    applies: (path) => SOURCE.test(path),
    test: (line) =>
      /\brounded-full\b|rounded-\[(?:9{3,}px|50%)\]|border-radius\s*:\s*(?:9{3,}px|50%)|borderRadius\s*:\s*["']?(?:9{3,}|50%)/.test(
        line,
      ),
  },
  {
    id: "streak",
    message: "streaks or guilt copy (Children's Code nudge standard)",
    applies: (path) => UI_COPY.test(path) && !isTest(path),
    test: (line) => /\bstreaks?\b|don'?t break your|you'?ll lose your/i.test(line),
  },
  {
    id: "confetti",
    message: "confetti packages",
    applies: (path) => path.endsWith("package.json"),
    test: (line) => /"[^"]*(confetti|party-js)[^"]*"\s*:/.test(line),
  },
];

/** Returns { rule, message, line, text } for every cliche found in one file's text. */
export function findCliches(path, text) {
  const normalised = path.replace(/\\/g, "/");
  const findings = [];
  const lines = text.split("\n");
  for (const rule of RULES) {
    if (!rule.applies(normalised)) continue;
    lines.forEach((line, index) => {
      if (line.includes(`cliche-lint-allow: ${rule.id}`)) return;
      if (rule.test(line)) {
        findings.push({ rule: rule.id, message: rule.message, line: index + 1, text: line.trim() });
      }
    });
  }
  return findings;
}
