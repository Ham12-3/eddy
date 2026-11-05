/**
 * Fonts and maths styles, all self-hosted: students' browsers never contact a font service.
 * Import once at the app root (apps/web layout, Storybook preview).
 * OpenDyslexic is declared here but only downloaded when dyslexia mode uses it.
 */
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/atkinson-hyperlegible-next/index.css";
import "@fontsource-variable/caveat/index.css";
import "@fontsource/opendyslexic/index.css";
// KaTeX's fonts also serve MathLive (its own font loading is switched off in MathField).
import "katex/dist/katex.min.css";
