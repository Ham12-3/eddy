import { globalIgnores } from "eslint/config";

import base from "../../eslint.config.base.mjs";

export default [...base, globalIgnores(["resources/**", ".cache/**", "dist/**", "release/**"])];
