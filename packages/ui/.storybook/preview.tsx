import type { Decorator, Preview } from "@storybook/react-vite";
import "../src/assets";
import "../src/styles/index.css";

/**
 * Applies Eddy's mode switches to <html>, as the app will: data-theme (otherwise the system
 * colour scheme), data-reading="dyslexia" and data-motion="reduce". Set from the toolbar or the
 * URL, for example ?globals=theme:dark;reading:dyslexia.
 */
const withModes: Decorator = (Story, context) => {
  const root = document.documentElement;
  const { theme, reading, motion } = context.globals as Record<string, string | undefined>;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  if (reading === "dyslexia") root.setAttribute("data-reading", "dyslexia");
  else root.removeAttribute("data-reading");
  if (motion === "reduce") root.setAttribute("data-motion", "reduce");
  else root.removeAttribute("data-motion");
  root.lang = "en-GB";
  return <Story />;
};

const preview: Preview = {
  decorators: [withModes],
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: { title: "Theme", items: ["system", "light", "dark"], dynamicTitle: true },
    },
    reading: {
      description: "Reading mode",
      toolbar: { title: "Reading", items: ["standard", "dyslexia"], dynamicTitle: true },
    },
    motion: {
      description: "Motion",
      toolbar: { title: "Motion", items: ["system", "reduce"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "system", reading: "standard", motion: "system" },
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    a11y: { test: "error" },
  },
};

export default preview;
