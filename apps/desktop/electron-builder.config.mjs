// pnpm --filter @eddy/desktop dist           a build for students
// pnpm --filter @eddy/desktop dist:preview   a preview build for the people making Eddy
//
// Packs the shell and the built parts (`resources/`, made by `pnpm build`) into one Windows
// set-up program (ADR-0036). It installs for the person who runs it, with no administrator
// rights, and needs no internet then or afterwards.

/**
 * @param {{ preview: boolean }} options A preview runs the API in its development environment,
 *   which opens the tutor before the safeguarding help script is approved (src/main.mjs). So a
 *   build is a preview only when asked for by name, and its set-up program says so in its name.
 * @returns {import("electron-builder").Configuration}
 */
export function configFor({ preview }) {
  return {
    appId: "uk.eddy.desktop",
    productName: "Eddy",
    copyright: "Eddy",
    directories: { output: "release" },
    // The installed folder and its entry in Windows are named after `name`, not after the
    // workspace package ("@eddy/desktop"). The preview flag in package.json is for running from
    // source; what is packed carries the one chosen here.
    extraMetadata: { name: "eddy", eddy: { preview } },
    // The shell itself: a handful of files with no dependencies of their own.
    files: [
      "package.json",
      "src/*.mjs",
      "src/starting.html",
      "src/tokens.css",
      // Tests, and the two helpers only the tests use.
      "!src/*.test.mjs",
      "!src/run-services.mjs",
      "!src/node-child.mjs",
    ],
    // Everything the shell runs: the web server, the scene service, the two Python programs,
    // PostgreSQL and the curriculum. The shell finds it as `<resources>/eddy`.
    extraResources: [{ from: "resources", to: "eddy" }],
    asar: true,
    npmRebuild: false,
    // Eddy never looks for a newer copy of itself: that would be a request to the internet.
    publish: null,
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
    },
    nsis: {
      // One step, for this Windows account only: no administrator password is asked for, so the
      // helper that asks for one is left out.
      oneClick: true,
      perMachine: false,
      packElevateHelper: false,
      artifactName: preview
        ? "Eddy-Preview-Setup-${version}.${ext}"
        : "Eddy-Setup-${version}.${ext}",
      shortcutName: "Eddy",
      // Removing the program leaves the student's work where it is: the data folder under the
      // Windows account's local app-data folder (apps/desktop/README.md). The full privacy
      // notice says how to remove that too.
      deleteAppDataOnUninstall: false,
    },
    // The shell is only ever Eddy. It cannot be turned into a general script runner, told what
    // to load by an environment variable, or opened to a debugger, and its own code is loaded
    // only from the packed archive, checked against what was packed.
    //
    // That check covers the shell's few files and nothing else. The services under
    // `resources/eddy` are plain files in a folder the Windows account can write to, and nothing
    // is code-signed, so none of this stops a program already running as that person from
    // changing Eddy. It stops Eddy being misused through its environment or command line.
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
      // grantFileProtocolExtraPrivileges stays on. With it off the packed app could not load its
      // starting page from the archive (ERR_FILE_NOT_FOUND, tried on 26 November 2026). The
      // window may load exactly that page and its stylesheet from a file and nothing else
      // (src/window-policy.mjs).
    },
  };
}

export default configFor({ preview: process.env.EDDY_DESKTOP_PREVIEW === "1" });
