import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCliches } from "./cliches.mjs";

const rulesFor = (path, text) => findCliches(path, text).map((finding) => finding.rule);

describe("cliche lint", () => {
  const cases = [
    [
      "purple-gradient",
      "x.tsx",
      '<div className="bg-linear-to-r from-indigo-500 to-purple-600" />',
    ],
    ["purple-gradient", "x.css", "background: linear-gradient(90deg, violet, blue);"],
    ["default-palette", "x.tsx", '<p className="text-zinc-500" />'],
    ["raw-colour", "apps/web/src/x.css", "color: #7c3aed;"],
    ["raw-colour", "apps/web/src/x.tsx", "style={{ color: 'rgb(124, 58, 237)' }}"],
    ["glass", "x.tsx", '<div className="backdrop-blur-md" />'],
    ["emoji", "x.tsx", "<p>Well done! \u{1F389}</p>"],
    ["inter-font", "x.css", "font-family: Inter, sans-serif;"],
    ["hype-copy", "x.tsx", "<h1>Unlock your potential</h1>"],
    ["sparkle", "x.tsx", 'import { Sparkles } from "lucide-react";'],
    ["text-shadow", "x.css", "text-shadow: 0 0 4px black;"],
    ["glow", "x.tsx", '<div className="shadow-2xl" />'],
    ["glow", "x.css", "box-shadow: 0 0 20px orange;"],
    ["pill", "x.tsx", '<button className="rounded-full px-6">Go</button>'],
    ["streak", "x.tsx", "<p>Keep your 7-day streak going!</p>"],
    ["confetti", "package.json", '    "canvas-confetti": "1.9.0",'],
    // Gaps the M1 review found
    ["inter-font", "x.tsx", 'import { Inter } from "next/font/google";'],
    ["inter-font", "x.tsx", "const inter = Inter({ subsets: ['latin'] });"],
    ["inter-font", "x.ts", 'import "@fontsource-variable/inter";'],
    ["inter-font", "x.css", '--font-sans: "Inter Variable", system-ui;'],
    ["sparkle", "x.tsx", 'import { SparklesIcon } from "@heroicons/react/24/outline";'],
    ["sparkle", "x.tsx", 'import { HiSparkles } from "react-icons/hi";'],
    ["sparkle", "x.tsx", "<WandSparkles />"],
    ["confetti", "package.json", '    "react-canvas-confetti": "2.0.0",'],
    ["confetti", "package.json", '    "@tsparticles/confetti": "3.0.0",'],
    ["text-shadow", "x.tsx", "style={{ textShadow: '0 0 8px gold' }}"],
    ["glow", "x.tsx", 'style={{ boxShadow: "0 0 24px var(--accent)" }}'],
    ["glow", "x.css", "filter: drop-shadow(0 0 6px var(--accent));"],
    ["pill", "x.tsx", '<button className="rounded-[9999px]">Go</button>'],
    ["pill", "x.css", "border-radius: 9999px;"],
    ["raw-colour", "apps/web/src/x.tsx", '<div className="from-[orchid] to-[plum]" />'],
    ["raw-colour", "apps/web/src/x.tsx", 'style={{ color: "purple" }}'],
    ["raw-colour", "apps/web/src/x.jsx", "color: #7c3aed;"],
    ["emoji", "x.tsx", "<p>Made in the UK \u{1F1EC}\u{1F1E7}</p>"],
    ["glow", "x.svg", '<rect style="filter: drop-shadow(0 0 4px var(--ink))" />'],
  ];

  for (const [rule, path, text] of cases) {
    it(`catches ${rule}: ${text}`, () => {
      assert.ok(
        rulesFor(path, text).includes(rule),
        `expected ${rule} in ${JSON.stringify(rulesFor(path, text))}`,
      );
    });
  }

  const clean = [
    [
      "x.tsx",
      '<button className="rounded-control bg-accent text-on-accent shadow-raised">Check</button>',
    ],
    ["x.tsx", '<a href="#privacy">Privacy notice</a>'],
    ["x.tsx", '<span className="rounded-full" /> // cliche-lint-allow: pill (toggle track)'],
    ["packages/ui/src/tokens/tokens.ts", 'paper: "#F6F3EA",'],
    ["packages/ui/src/contrast.test.ts", 'expect(contrastRatio("#000000", "#FFFFFF"))'],
    ["x.css", "--shadow-*: initial;"],
    ["x.tsx", "<p>Your next review is due on Thursday.</p>"],
    // False positives the M1 review found
    ["apps/web/src/x.tsx", '<a href="#add">Add a topic</a>'],
    ["apps/web/src/x.tsx", '<a href="#decade">Decade</a>'],
    ["x.tsx", "<p>© Eddy 2026</p>"],
    ["x.css", "--text-shadow-*: initial;"],
  ];

  for (const [path, text] of clean) {
    it(`allows: ${text}`, () => {
      assert.deepEqual(rulesFor(path, text), []);
    });
  }
});
