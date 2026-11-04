import { defineConfig, globalIgnores } from "eslint/config";
import base from "../eslint.config.base.mjs";

export default defineConfig([globalIgnores(["cdk.out/"]), base]);
