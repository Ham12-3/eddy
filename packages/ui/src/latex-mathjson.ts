/**
 * LaTeX from the maths field (MathLive with the Foundation keyboard) to the MathJSON that
 * maths-core accepts (ADR-0004). Nothing is evaluated here: this only rebuilds the structure the
 * student typed, and maths-core checks it against its allow-list.
 *
 * Numbers keep the digits as typed ({"num": "2.50"}), because a JSON number would lose trailing
 * zeros that decimal-place questions need. Whole numbers of up to 15 digits are plain integers,
 * so "2 1/2" can be read as a mixed number.
 */

export type MathJson = number | string | { num: string } | MathJson[];

export class LatexError extends Error {
  override name = "LatexError";
}

const UNITS = new Set(["mm", "cm", "m", "km", "g", "kg", "ml", "l", "s", "min", "h"]);
const RELATIONS: Record<string, string> = {
  "=": "Equal",
  "<": "Less",
  ">": "Greater",
  "\\le": "LessEqual",
  "\\leq": "LessEqual",
  "\\ge": "GreaterEqual",
  "\\geq": "GreaterEqual",
  "\\ne": "NotEqual",
  "\\neq": "NotEqual",
};
const IGNORED = new Set(["\\,", "\\;", "\\:", "\\!", "\\ ", "\\left", "\\right", "\\pounds", "£"]);

type Token = string;

function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < latex.length) {
    const ch = latex[i] ?? "";
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const word = /^\\([A-Za-z]+|.)/.exec(latex.slice(i));
      if (!word) throw new LatexError("That answer could not be read.");
      tokens.push(word[0]);
      i += word[0].length;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      // Digits, a decimal point, and MathLive's thousands groups ("1{,}000").
      let number = "";
      while (i < latex.length) {
        const rest = latex.slice(i);
        if (/^[0-9.]/.test(rest)) {
          number += rest[0];
          i += 1;
        } else if (rest.startsWith("{,}") && /[0-9]/.test(rest[3] ?? "")) {
          i += 3;
        } else break;
      }
      tokens.push(`#${number}`);
      continue;
    }
    tokens.push(ch);
    i += 1;
  }
  return tokens.filter((token) => !IGNORED.has(token));
}

function numberNode(text: string): MathJson {
  if (!/^\d+(\.\d+)?$|^\.\d+$|^\d+\.$/.test(text)) {
    throw new LatexError("That number could not be read.");
  }
  const clean = text.endsWith(".") ? text.slice(0, -1) : text.startsWith(".") ? `0${text}` : text;
  if (/^\d{1,15}$/.test(clean)) return Number(clean);
  return { num: clean };
}

const isWholeLiteral = (node: MathJson): node is number =>
  typeof node === "number" && Number.isInteger(node) && node >= 0;

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.position + offset];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    if (token === undefined) throw new LatexError("That answer looks unfinished.");
    this.position += 1;
    return token;
  }

  private expect(token: Token): void {
    if (this.next() !== token) throw new LatexError("That answer could not be read.");
  }

  parse(): MathJson {
    if (this.tokens.length === 0) throw new LatexError("Type an answer first.");
    const first = this.relation();
    const parts = [first];
    let head: string | null = null;
    while (this.peek() === "," || this.peek() === ":") {
      const separator = this.next();
      if (separator === "," && /^#\d{3}$/.test(this.peek() ?? "")) {
        // "1,000": a thousands comma, which would otherwise read as a pair of numbers.
        throw new LatexError("Write the number without commas, like 1000.");
      }
      const wanted = separator === "," ? "Tuple" : "Ratio";
      if (head && head !== wanted) throw new LatexError("That answer could not be read.");
      head = wanted;
      parts.push(this.relation());
    }
    if (this.position < this.tokens.length) throw new LatexError("That answer could not be read.");
    return head ? [head, ...parts] : first;
  }

  private relation(): MathJson {
    const left = this.sum();
    const op = this.peek();
    if (op !== undefined && RELATIONS[op]) {
      this.next();
      return [RELATIONS[op] as string, left, this.sum()];
    }
    return left;
  }

  private sum(): MathJson {
    let left = this.term();
    for (;;) {
      const op = this.peek();
      if (op === "+") {
        this.next();
        left = ["Add", left, this.term()];
      } else if (op === "-") {
        this.next();
        left = ["Subtract", left, this.term()];
      } else return left;
    }
  }

  private startsPrimary(token: Token | undefined): boolean {
    if (token === undefined) return false;
    return (
      token.startsWith("#") ||
      /^[A-Za-z]$/.test(token) ||
      [
        "(",
        "{",
        "|",
        "\\frac",
        "\\dfrac",
        "\\tfrac",
        "\\sqrt",
        "\\pi",
        "\\mathrm",
        "\\text",
      ].includes(token)
    );
  }

  private term(): MathJson {
    let left = this.unary();
    for (;;) {
      const op = this.peek();
      if (op === "\\times" || op === "\\cdot" || op === "*") {
        this.next();
        left = ["Multiply", left, this.unary()];
      } else if (op === "\\div" || op === "/") {
        this.next();
        left = ["Divide", left, this.unary()];
      } else if (this.startsPrimary(op)) {
        if (typeof left === "number" && (this.peek() ?? "").startsWith("#")) {
          // maths-core refuses two numbers side by side ("2 3"), and so do we.
          throw new LatexError("Put an operation between the two numbers.");
        }
        const right = this.unary();
        const fraction =
          Array.isArray(right) &&
          right[0] === "Divide" &&
          isWholeLiteral(right[1] as MathJson) &&
          isWholeLiteral(right[2] as MathJson);
        if (fraction && isWholeLiteral(left)) {
          // 2\frac{1}{2}: a mixed number.
          left = ["InvisibleOperator", left, right];
        } else if (
          fraction &&
          Array.isArray(left) &&
          left[0] === "Negate" &&
          isWholeLiteral(left[1] as MathJson)
        ) {
          // -2\frac{1}{2} is minus two and a half, not -2 times a half.
          left = ["Negate", ["InvisibleOperator", left[1] as MathJson, right]];
        } else {
          left = ["Multiply", left, right];
        }
      } else return left;
    }
  }

  private unary(): MathJson {
    if (this.peek() === "-") {
      this.next();
      return ["Negate", this.unary()];
    }
    if (this.peek() === "+") {
      this.next();
      return this.unary();
    }
    return this.postfix();
  }

  private postfix(): MathJson {
    let base = this.primary();
    for (;;) {
      const token = this.peek();
      if (token === "^") {
        this.next();
        if (this.peek() === "\\circ") {
          this.next();
          base = ["Degrees", base];
          continue;
        }
        if (this.peek() === "{" && this.peek(1) === "\\circ" && this.peek(2) === "}") {
          this.position += 3;
          base = ["Degrees", base];
          continue;
        }
        base = ["Power", base, this.atom()];
      } else if (token === "\\%" || token === "%") {
        this.next();
        base = ["Percent", base];
      } else if (token === "\\degree" || token === "°") {
        this.next();
        base = ["Degrees", base];
      } else return base;
    }
  }

  /** A single-token or braced argument, as after ^. */
  private atom(): MathJson {
    if (this.peek() === "{") return this.group();
    const token = this.next();
    if (token.startsWith("#")) {
      // x^23 in LaTeX means x^2 then 3; MathLive always braces, so take the whole number.
      return numberNode(token.slice(1));
    }
    if (/^[A-Za-z]$/.test(token)) return token;
    throw new LatexError("That answer could not be read.");
  }

  private group(): MathJson {
    this.expect("{");
    if (this.peek() === "}") throw new LatexError("That answer has an empty box. Fill it in.");
    const inner = this.sum();
    this.expect("}");
    return inner;
  }

  private word(): string {
    this.expect("{");
    let text = "";
    while (this.peek() !== "}") {
      const token = this.next();
      text += token.startsWith("#") ? token.slice(1) : token;
    }
    this.expect("}");
    return text.trim();
  }

  private primary(): MathJson {
    const token = this.next();
    if (token.startsWith("#")) return numberNode(token.slice(1));
    if (/^[A-Za-z]$/.test(token)) {
      // A run of letters that spells a multi-letter unit (cm, kg, min) is the unit.
      let length = 1;
      while (/^[A-Za-z]$/.test(this.peek(length - 1) ?? "")) length += 1;
      for (let take = length; take > 1; take -= 1) {
        const word = [token, ...this.tokens.slice(this.position, this.position + take - 1)].join(
          "",
        );
        if (UNITS.has(word)) {
          this.position += take - 1;
          return word;
        }
      }
      return token;
    }
    switch (token) {
      case "(": {
        const items = [this.relation()];
        while (this.peek() === ",") {
          this.next();
          items.push(this.relation());
        }
        this.expect(")");
        return ["Delimiter", items.length > 1 ? ["Tuple", ...items] : (items[0] as MathJson)];
      }
      case "{":
        this.position -= 1;
        return this.group();
      case "|": {
        const inner = this.sum();
        this.expect("|");
        return ["Abs", inner];
      }
      case "\\frac":
      case "\\dfrac":
      case "\\tfrac": {
        const top = this.group();
        const bottom = this.group();
        return ["Divide", top, bottom];
      }
      case "\\sqrt": {
        if (this.peek() === "[") {
          this.next();
          const index = this.sum();
          this.expect("]");
          return ["Root", this.group(), index];
        }
        return ["Sqrt", this.group()];
      }
      case "\\pi":
        return "Pi";
      case "\\mathrm":
      case "\\text": {
        const unit = this.word();
        if (!UNITS.has(unit)) throw new LatexError("That answer uses a word Eddy cannot check.");
        return unit;
      }
      case "\\placeholder":
        throw new LatexError("That answer has an empty box. Fill it in.");
      default:
        throw new LatexError("That answer uses something Eddy cannot check yet.");
    }
  }
}

/** The MathJSON for what the student typed, or a LatexError with a message to show them. */
export function latexToMathJson(latex: string): MathJson {
  return new Parser(tokenize(latex)).parse();
}
