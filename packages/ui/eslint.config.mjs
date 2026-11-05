import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import base from "../../eslint.config.base.mjs";

export default defineConfig([
  globalIgnores(["storybook-static/"]),
  base,
  reactHooks.configs.flat.recommended,
]);
