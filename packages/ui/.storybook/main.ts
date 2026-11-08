import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y"],
  // Storybook's own usage telemetry stays off.
  core: { disableTelemetry: true },
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import("vite");
    return mergeConfig(viteConfig, { plugins: [react(), tailwindcss()] });
  },
};

export default config;
