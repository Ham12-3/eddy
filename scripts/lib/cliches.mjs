/**
 * The "no AI slop" rules from SPEC.md section 11 and the brief's design section, as checks.
 * A line can opt out of one rule with a trailing comment `cliche-lint-allow: <rule> (<reason>)`.
 */

const SOURCE = /\.(ts|tsx|css|mdx|html)$/;
const UI_COPY = /\.(tsx|mdx|html)$/;
const isTest = (path) => /\.test\.|\.spec\.|\/e2e/.test(path);

export const RULES = [
  {
    id: "purple-gradient",
    message: "purple or blue-to-purple gradients",
    applies: (path) => SOURCE.test(path),
    test: (line) =>
      /(linear|radial|conic)-gradient|bg-(gradient|linear|radial|conic)-/.test(line) &&
      /purple|violet|indigo|fuchsia|magenta/i.test(line),
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
    message: "raw colour values outside the token source (packages/ui/src/tokens/tokens.ts)",
    applies: (path) =>
      SOURCE.test(path) &&
      !isTest(path) &&
      !path.endsWith("packages/ui/src/tokens/tokens.ts") &&
      !path.endsWith("packages/ui/src/styles/tokens.css"),
    test: (line) =>
      /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?!-)/.test(line) ||
      /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*\d/.test(line),
  },
  {
    id: "glass",
    message: "glassmorphism (backdrop blur)",
    applies: (path) => SOURCE.test(path),
    test: (line) => /backdrop-filter|backdrop-blur|\bglass(morphism)?\b/i.test(line),
  },
  {
    id: "emoji",
    message: "emoji in UI code or copy",
    applies: (path) => SOURCE.test(path),
    test: (line) => /\p{Extended_Pictographic}/u.test(line),
  },
  {
    id: "inter-font",
    message: "Inter as a typeface",
    applies: (path) => SOURCE.test(path),
    test: (line) => /font-family[^;]*\bInter\b|["']Inter["']|\bfont-inter\b/.test(line),
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
    test: (line) => /\bsparkles?\b/i.test(line),
  },
  {
    id: "text-shadow",
    message: "drop shadows on text",
    applies: (path) => SOURCE.test(path),
    // The theme line that switches text shadows off (--text-shadow-*: initial) is fine.
    test: (line) => /(?<![-w])text-shadow/.test(line),
  },
  {
    id: "glow",
    message: "shadows other than the single shadow-raised token (neon glows, soft drop shadows)",
    applies: (path) => SOURCE.test(path) && !path.endsWith("packages/ui/src/styles/tokens.css"),
    test: (line) =>
      /\b(?:drop-)?shadow-(?!raised\b|none\b|\*)[\w[(]/.test(line) || /box-shadow\s*:/.test(line),
  },
  {
    id: "pill",
    message: "pill shapes (rounded-full) outside toggles",
    applies: (path) => SOURCE.test(path),
    test: (line) => /\brounded-full\b/.test(line),
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
    test: (line) =>
      /"(canvas-confetti|react-confetti|js-confetti|party-js|tsparticles-confetti)"/.test(line),
  },
];

/** Returns { rule, line, text } for every cliche found in one file's text. */
export function findCliches(path, text) {
  const normalised = path.replace(/\\/g, "/");
  const findings = [];
  const lines = text.split("\n");
  for (const rule of RULES) {
    if (!rule.applies(normalised)) continue;
    lines.forEach((line, index) => {
      if (line.includes(`cliche-lint-allow: ${rule.id}`)) return;
      if (rule.test(line))
        findings.push({ rule: rule.id, message: rule.message, line: index + 1, text: line.trim() });
    });
  }
  return findings;
}
