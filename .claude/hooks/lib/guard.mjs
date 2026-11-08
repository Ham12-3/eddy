/**
 * Rules for the PreToolUse guard on the Bash and PowerShell tools (PLAN.md M0). `evaluate` returns
 * a reason to deny a command line, or null. Denied:
 *   1. recursive deletes outside temp folders (rm -r, Remove-Item -Recurse, rd /s, find -delete,
 *      rimraf, shutil.rmtree and friends), and git clean -f
 *   2. dropping databases or schemas, and deleting database volumes
 *   3. Alembic commands against a database that is not local, or that cannot be identified
 *   4. force pushes, mirror pushes and remote branch deletion
 *   5. shell writes under compliance/ (edits there go through the permission prompt instead)
 *   6. reading, copying, sending or dumping .env files (.env.example is fine)
 * Commands inside if/then/do blocks, script blocks, subshells, $(...) and bash -c are checked too.
 * Heredoc and here-string bodies are text, not commands, unless they feed a SQL client.
 * Heuristic by design: it stops honest mistakes; it is not a sandbox. When unsure, it denies.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOCAL_DB_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
  "host.docker.internal",
]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "pwsh", "powershell", "cmd"]);
// Words that run whatever command follows them.
const WRAPPERS = new Set([
  "sudo",
  "command",
  "exec",
  "time",
  "nohup",
  "env",
  "nice",
  "timeout",
  "xargs",
  "npx",
  "pnpx",
  "bunx",
  "&",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "try",
  "catch",
  "finally",
  "foreach-object",
  "%",
]);
const PACKAGE_RUNNERS = new Set(["pnpm", "npm", "yarn"]);
// Commands whose arguments are text, not files to act on.
const TEXT_ONLY = new Set([
  "grep",
  "rg",
  "egrep",
  "fgrep",
  "findstr",
  "select-string",
  "sls",
  "git",
  "gh",
  "echo",
  "printf",
  "write-output",
  "write-host",
]);
const SEARCH_TOOLS = new Set(["grep", "egrep", "fgrep", "rg", "findstr", "select-string", "sls"]);
const ENV_READERS = new Set([
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "bat",
  "type",
  "get-content",
  "gc",
  "nano",
  "vim",
  "vi",
  "view",
  "code",
  "notepad",
  "sed",
  "awk",
  "strings",
  "xxd",
  "od",
  "hexdump",
  "base64",
  "source",
  ".",
  "diff",
  "nl",
  "sort",
  "cut",
  "tac",
  "perl",
  "jq",
  "uniq",
  "rev",
  "paste",
  "column",
  "iconv",
]);
const COPIERS = new Set(["cp", "copy", "copy-item", "cpi", "scp", "rsync"]);
const MOVERS = new Set(["mv", "move", "move-item", "mi", "ren", "rename-item", "rni"]);
const FILE_WRITERS = new Set([
  "tee",
  "touch",
  "rm",
  "rmdir",
  "truncate",
  "dd",
  "set-content",
  "add-content",
  "out-file",
  "new-item",
  "remove-item",
  "clear-content",
  "ni",
  "ri",
  "del",
  "erase",
  "sc",
  "ac",
]);
const CHANGE_DIR = new Set(["cd", "pushd", "set-location", "sl", "chdir"]);
const DROP = /\bdrop\s+(database|schema)\b/i;
const SQL_CLIENT = /\b(psql|mysql|sqlite3|sqlcmd)\b/i;
const PS_RECURSE = /^-r(e(c(u(r(s(e)?)?)?)?)?)?(:\$?true)?$/i;
const PS_VALUE_PARAMS =
  /^-(erroraction|ea|warningaction|wa|informationaction|infa|include|exclude|filter|stream|credential|outvariable|ov|errorvariable|ev)$/i;
const ENV_PATH = /(?:^|[\s"'`/\\=(,@])(\.env(?:\.[\w*-]+)*\*?)(?=$|[\s"'`),;])/g;

// ---------------------------------------------------------------- parsing

/** Remove heredoc bodies and PowerShell here-strings: their lines are text, not commands. */
export function stripHeredocs(command) {
  const withoutHereStrings = command
    .replace(/@'[\s\S]*?\n'@/g, "''")
    .replace(/@"[\s\S]*?\n"@/g, '""');
  const kept = [];
  const pending = [];
  for (const line of withoutHereStrings.split("\n")) {
    if (pending.length > 0) {
      if (line.replace(/^\t+/, "").trim() === pending[0]) pending.shift();
      continue;
    }
    kept.push(line);
    for (const match of line.matchAll(/(?<!<)<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g)) {
      pending.push(match[2]);
    }
  }
  return kept.join("\n");
}

/** Bodies of $(...) and backtick substitutions, which run even inside double quotes. */
export function substitutions(text) {
  return [...text.matchAll(/\$\(([^()]*)\)/g), ...text.matchAll(/`([^`\n]*)`/g)].map(
    (match) => match[1],
  );
}

/** Split a command line into simple commands at ; && || | & { } ( ) and newlines, respecting quotes. */
export function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  let callDepth = 0; // inside name(...) calls such as [IO.File]::ReadAllText(...)
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const prev = command[i - 1];
    const next = command[i + 1];
    if (ch === "(" && /[\w\]]/.test(prev ?? "")) {
      callDepth++;
      current += ch;
      continue;
    }
    if (ch === ")" && callDepth > 0) {
      callDepth--;
      current += ch;
      continue;
    }
    const redirectAmp = ch === "&" && (prev === ">" || next === ">");
    const clobberPipe = ch === "|" && prev === ">";
    const separator = !redirectAmp && !clobberPipe && /[;\n|&{}()]/.test(ch);
    if (separator) {
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) i++;
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

/** Split one simple command into words, removing quotes. */
export function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function exeName(token = "") {
  const base = token.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/** Drop leading VAR=value assignments and wrappers such as sudo, timeout 60, xargs -n 1 or npx. */
function stripPrefixes(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const name = exeName(token);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      i++;
    } else if (WRAPPERS.has(name)) {
      i++;
      while (i < tokens.length && (/^-/.test(tokens[i]) || /^\d+[smhd]?$/.test(tokens[i]))) i++;
    } else if (PACKAGE_RUNNERS.has(name) && ["exec", "dlx", "x"].includes(tokens[i + 1])) {
      i += 2;
    } else {
      break;
    }
  }
  return tokens.slice(i);
}

function normalisePath(path) {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function isTempPath(path) {
  const p = normalisePath(path);
  if (p.split("/").includes("..")) return false;
  return (
    /^\/tmp\/./.test(p) ||
    /^\/var\/folders\/./.test(p) ||
    /^(\$tmpdir|\$\{tmpdir\}|\$env:temp|\$env:tmp|%temp%|%tmp%)\/./.test(p) ||
    /\/appdata\/local\/temp\/./.test(p)
  );
}

function isEnvFile(token) {
  const base = normalisePath(token).split("/").pop() ?? "";
  return /^\.env/.test(base) && !base.endsWith(".example");
}

function mentionsCompliance(token) {
  const p = normalisePath(token);
  return p === "compliance" || p.endsWith("/compliance") || /(^|\/)compliance\//.test(p);
}

function shortFlags(args) {
  return args
    .filter((arg) => /^-[^-]/.test(arg))
    .map((arg) => arg.slice(1))
    .join("");
}

/** Positional arguments, skipping flags and the values of PowerShell parameters that take one. */
function positionals(args) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (PS_VALUE_PARAMS.test(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-") || /^\/[a-z]$/i.test(arg)) continue;
    result.push(arg);
  }
  return result;
}

/** The git subcommand and its arguments, skipping global options such as -C <path>. */
function gitSubcommand(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    i += ["-C", "-c"].includes(args[i]) ? 2 : 1;
  }
  return { sub: args[i], rest: args.slice(i + 1) };
}

function envPaths(text) {
  return [...text.matchAll(ENV_PATH)].map((match) => match[1]).filter((path) => isEnvFile(path));
}

// ---------------------------------------------------------------- rules

function recursiveDelete(exe, args, segment) {
  const flags = shortFlags(args);
  const unixRecursive = /[rR]/.test(flags) || args.includes("--recursive");
  const psRecursive = args.some((arg) => PS_RECURSE.test(arg));
  const cmdRecursive = args.some((arg) => /^\/s$/i.test(arg));

  let targets = null;
  if (exe === "rm" && (unixRecursive || psRecursive)) targets = positionals(args);
  if (["remove-item", "ri"].includes(exe) && psRecursive) targets = positionals(args);
  if (["rd", "rmdir", "del", "erase"].includes(exe) && (psRecursive || cmdRecursive)) {
    targets = positionals(args);
  }
  if (exe === "rimraf") targets = positionals(args);
  if (exe === "find" && args.includes("-delete")) {
    const firstExpression = args.findIndex((arg) => arg.startsWith("-"));
    targets = args.slice(0, firstExpression === -1 ? args.length : firstExpression);
    if (targets.length === 0) targets = ["."];
  }
  if (targets !== null && (targets.length === 0 || !targets.every(isTempPath))) {
    return `recursive delete outside a temp folder (${targets.join(" ") || "no target"}).`;
  }
  if (!TEXT_ONLY.has(exe) && /\b(rmtree|rmSync|rmdirSync|rimraf)\s*\(/.test(segment)) {
    return "recursive delete from inline code.";
  }
  return null;
}

function gitRules(exe, args) {
  if (exe !== "git") return null;
  const { sub, rest } = gitSubcommand(args);
  const flags = shortFlags(rest);
  if (sub === "clean") {
    const forced = /f/.test(flags) || rest.includes("--force");
    const dryRun = /n/.test(flags) || rest.includes("--dry-run");
    if (forced && !dryRun) {
      return "git clean -f deletes untracked files (with -x, also the git-ignored .env keys).";
    }
  }
  if (sub === "push") {
    const destructive = rest.some(
      (arg) =>
        /^--(force(-with-lease|-if-includes)?|mirror|delete|prune)(=.*)?$/.test(arg) ||
        /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(arg) ||
        arg.startsWith("+") ||
        arg.startsWith(":"),
    );
    if (destructive) return "force, mirror or deleting pushes rewrite shared history.";
  }
  return null;
}

function databaseDestruction(exe, args, segment) {
  if (!TEXT_ONLY.has(exe) && DROP.test(segment)) return "dropping a database or schema.";
  if (exe === "dropdb") return "dropping a database.";
  const compose = (exe === "docker" && args[0] === "compose") || exe === "docker-compose";
  if (compose && args.includes("down") && (args.includes("-v") || args.includes("--volumes"))) {
    return "docker compose down -v deletes the local database volume.";
  }
  if (exe === "docker" && args[0] === "volume" && ["rm", "prune"].includes(args[1])) {
    return "deleting Docker volumes (they hold the local database).";
  }
  if (
    exe === "docker" &&
    args[0] === "system" &&
    args[1] === "prune" &&
    args.includes("--volumes")
  ) {
    return "docker system prune --volumes deletes the local database volume.";
  }
  return null;
}

function databaseHost(url) {
  try {
    return new URL(url.replace(/^[a-z0-9+.-]+:\/\//i, "postgres://")).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function readDotEnvDatabaseUrl(root) {
  for (const file of ["services/api/.env", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const match = /^DATABASE_URL=(.*)$/im.exec(readFileSync(path, "utf8"));
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const ALEMBIC_DB_COMMANDS = new Set([
  "upgrade",
  "downgrade",
  "stamp",
  "current",
  "check",
  "revision",
]);

function alembicTarget(allTokens, command, context) {
  const index = allTokens.findIndex((token) => exeName(token) === "alembic");
  if (index === -1) return null;
  const rest = allTokens.slice(index + 1);
  const subcommand = rest.find((token) => ALEMBIC_DB_COMMANDS.has(token));
  if (!subcommand) return null;

  if (allTokens.some((token) => token.startsWith("--env-file"))) {
    return `alembic ${subcommand} with --env-file: cannot tell which database it targets.`;
  }
  const urls = [];
  for (const token of rest) {
    const option = /^(?:url|sqlalchemy\.url|db_url|database_url)=(.+)$/i.exec(token);
    if (option) urls.push(option[1]);
  }
  for (const match of command.matchAll(
    /(?:^|[\s;&|(])(?:export\s+|set\s+|\$env:)?database_url\s*=\s*["']?([^"'\s;&|]+)/gi,
  )) {
    urls.push(match[1]);
  }
  if (urls.length === 0) {
    const fromEnv =
      context.env.DATABASE_URL ?? context.env.database_url ?? context.readDatabaseUrl();
    if (fromEnv === undefined) return null; // falls back to the local default in eddy_api.config
    urls.push(fromEnv);
  }
  for (const url of urls) {
    const host = databaseHost(url);
    if (!host || !LOCAL_DB_HOSTS.has(host)) {
      return `alembic ${subcommand} would run against a non-local database (host: ${host ?? "unparseable URL"}).`;
    }
  }
  return null;
}

function complianceWrite(exe, args, segment, inCompliance) {
  const message =
    "shell writes under compliance/. Use the Edit or Write tool so the user is asked first.";
  for (const match of segment.matchAll(/(?<![<0-9])>{1,2}\|?\s*["']?([^\s"'|;&]+)/g)) {
    const target = match[1];
    const relative = !/^([a-z]:|\/|\\|\$|%)/i.test(target);
    if (mentionsCompliance(target) || (inCompliance && relative)) return message;
  }
  const touches = args.some(mentionsCompliance) || inCompliance;
  if (!touches) return null;

  if (COPIERS.has(exe)) {
    const destination = positionals(args).at(-1) ?? "";
    if (
      mentionsCompliance(destination) ||
      (inCompliance && !/^([a-z]:|\/|\\)/i.test(destination))
    ) {
      return message;
    }
    return null;
  }
  const inPlace = ["sed", "perl"].includes(exe) && args.some((arg) => /^-[a-zA-Z]*i/.test(arg));
  const gitOverwrite =
    exe === "git" && ["checkout", "restore", "rm", "mv"].includes(gitSubcommand(args).sub);
  if (inPlace || gitOverwrite || MOVERS.has(exe) || FILE_WRITERS.has(exe)) return message;
  return null;
}

function inlineComplianceWrite(exe, segment) {
  if (TEXT_ONLY.has(exe)) return null;
  const opensForWriting = /open\([^)]*compliance[\\/][^)]*,\s*["'][wax+]/i.test(segment);
  const writer =
    /(writeFileSync|writeFile|appendFileSync|write_text|write_bytes)\b[^\n]*compliance[\\/]/i.test(
      segment,
    );
  return opensForWriting || writer ? "writing under compliance/ from inline code." : null;
}

function searchPaths(exe, args) {
  if (["select-string", "sls"].includes(exe)) {
    const paths = [];
    let patternSeen = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (/^-(pattern)$/i.test(arg)) {
        patternSeen = true;
        i++;
      } else if (/^-(path|literalpath)$/i.test(arg)) {
        paths.push(args[++i] ?? "");
      } else if (!arg.startsWith("-")) {
        if (!patternSeen) patternSeen = true;
        else paths.push(arg);
      }
    }
    return paths;
  }
  const explicitPattern = args.some((arg) => /^(-e|-f|--regexp|--file)(=|$)/.test(arg));
  const plain = args.filter((arg) => !arg.startsWith("-") && !/^\/[a-z]$/i.test(arg));
  return explicitPattern ? plain : plain.slice(1);
}

function envFileRead(exe, args, segment, command) {
  if (SEARCH_TOOLS.has(exe)) {
    const targets = searchPaths(exe, args);
    if (targets.some(isEnvFile)) return "searching inside a .env file.";
    const excludesEnv = args.some((arg) => /^--exclude/.test(arg) && arg.includes(".env"));
    // Named files (with an extension) cannot pull in a .env file, even with -r.
    const onlyNamedFiles =
      targets.length > 0 &&
      targets.every((path) => /\.[\w-]+$/.test(path.split(/[\\/]/).pop() ?? ""));
    const grepRecursive =
      ["grep", "egrep", "fgrep"].includes(exe) &&
      (/[rR]/.test(shortFlags(args)) || args.includes("--recursive"));
    if (grepRecursive && !excludesEnv && !onlyNamedFiles) {
      return "recursive grep reads .env files. Use rg or the Grep tool (they respect .gitignore), or add --exclude='.env*'.";
    }
    if (exe === "findstr" && args.some((arg) => /^\/s$/i.test(arg))) {
      return "findstr /s reads .env files. Use rg or the Grep tool instead.";
    }
    if (
      exe === "rg" &&
      args.some((arg) => /^(--no-ignore|-u+)$/.test(arg)) &&
      !args.some((arg) => arg.includes("!.env"))
    ) {
      return "rg without ignore rules reads .env files. Add -g '!.env*'.";
    }
  }
  if (ENV_READERS.has(exe) && args.some(isEnvFile)) return "reading a .env file.";
  if (COPIERS.has(exe) || MOVERS.has(exe)) {
    const source = positionals(args)[0];
    if (source && isEnvFile(source)) return "copying or moving a .env file.";
  }
  if (/<\s*["']?([^\s"'<>|;&]+)/.test(segment)) {
    const source = /<\s*["']?([^\s"'<>|;&]+)/.exec(segment)?.[1] ?? "";
    if (isEnvFile(source)) return "reading a .env file through a redirect.";
  }
  if (segment.includes("@") && /@[^\s"']*\.env/.test(segment)) {
    const attached = [...segment.matchAll(/@([^\s"']+)/g)].map((match) => match[1]);
    if (attached.some(isEnvFile)) return "sending a .env file.";
  }
  if (!TEXT_ONLY.has(exe)) {
    const readsInline =
      /(open|readFileSync|readFile|read_text|Get-Content|loadEnvFile|dotenv_values|ReadAllText|ReadAllLines|ReadAllBytes)\b/i.test(
        segment,
      );
    if (readsInline && envPaths(segment).length > 0) return "reading a .env file from inline code.";
    const loadsEnvFile = /--env-file/.test(segment);
    const dumpsEnv =
      tokenize(segment).some((token) =>
        ["env", "printenv", "set", "get-childitem env:"].includes(token.toLowerCase()),
      ) ||
      /console\.log\(\s*process\.env\s*\)|os\.environ\b(?!\.get|\[)|Get-ChildItem\s+env:/i.test(
        segment,
      );
    if (loadsEnvFile && dumpsEnv) return "printing the environment after loading a .env file.";
  }
  if (
    /\b(get-childitem|gci|ls|dir)\b[^|]*-r(ecurse)?\b/i.test(command) &&
    /\b(select-string|sls)\b/i.test(command)
  ) {
    if (!/-exclude\s+["']?\.env/i.test(command)) {
      return "recursive Select-String reads .env files. Use rg or the Grep tool instead.";
    }
  }
  return null;
}

// ---------------------------------------------------------------- driver

function evaluateSegment(segment, command, context, depth, inCompliance) {
  const allTokens = tokenize(segment);
  const tokens = stripPrefixes(allTokens);
  if (tokens.length === 0) return null;
  const exe = exeName(tokens[0]);
  const args = tokens.slice(1);

  // bash -lc "...", pwsh -Command "...", cmd /c ...: check the inner command too.
  if (SHELLS.has(exe) && depth < 4) {
    const flagIndex = args.findIndex((arg) => /^(-[a-z]*c|-command|\/c)$/i.test(arg));
    if (flagIndex !== -1) {
      const reason = evaluate(args.slice(flagIndex + 1).join(" "), context, depth + 1);
      if (reason) return reason;
    }
  }
  // find ... -exec cmd {} +
  if (exe === "find" && depth < 4) {
    const execIndex = args.findIndex((arg) => ["-exec", "-execdir", "-ok"].includes(arg));
    if (execIndex !== -1) {
      const inner = [];
      for (const arg of args.slice(execIndex + 1)) {
        if ([";", "\\;", "+"].includes(arg)) break;
        inner.push(arg);
      }
      const reason = evaluate(inner.join(" "), context, depth + 1);
      if (reason) return reason;
    }
  }

  return (
    recursiveDelete(exe, args, segment) ??
    gitRules(exe, args) ??
    databaseDestruction(exe, args, segment) ??
    alembicTarget(allTokens, command, context) ??
    complianceWrite(exe, args, segment, inCompliance) ??
    inlineComplianceWrite(exe, segment) ??
    envFileRead(exe, args, segment, command)
  );
}

/**
 * Returns the reason to deny `command`, or null to allow it.
 * `context.env` is the environment; `context.readDatabaseUrl` finds DATABASE_URL in local .env files.
 */
export function evaluate(command, context = {}, depth = 0) {
  const fullContext = {
    env: context.env ?? {},
    readDatabaseUrl: context.readDatabaseUrl ?? (() => undefined),
  };
  if (SQL_CLIENT.test(command) && DROP.test(command)) {
    return "dropping a database or schema through a SQL client.";
  }
  const visible = stripHeredocs(command);
  if (depth < 4) {
    for (const inner of substitutions(visible)) {
      const reason = evaluate(inner, fullContext, depth + 1);
      if (reason) return reason;
    }
  }
  let inCompliance = false;
  for (const segment of splitSegments(visible)) {
    const tokens = stripPrefixes(tokenize(segment));
    if (CHANGE_DIR.has(exeName(tokens[0]))) {
      inCompliance = tokens.slice(1).some(mentionsCompliance);
      continue;
    }
    const reason = evaluateSegment(segment, visible, fullContext, depth, inCompliance);
    if (reason) return reason;
  }
  return null;
}
