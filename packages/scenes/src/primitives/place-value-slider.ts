import type { Rect } from "../canvas";
import { text } from "../layout/geometry";
import { LINE_HEIGHT, measureMaths, measureText } from "../layout/measure";
import type { MathNode, Role, SceneElement, TextElement } from "../layout/types";

/**
 * Place-value slider: a row of place-value columns (biggest on the left), each headed by its
 * place name and the power of ten it stands for, a row of cells under them for digits, and the
 * decimal point fixed between the ones and the tenths. Digits are placed in a column by power, so
 * moving a digit is drawing it in another column with the same id: multiplying by 10 to the
 * power -3 slides every digit 3 columns right.
 */

export interface PlaceValueOptions {
  id: string;
  /** The chart is centred across this region, from its top. */
  region: Rect;
  /** Powers of ten of the first (left) and last (right) columns. */
  high: number;
  low: number;
  /**
   * Heading sizes: place names (0 leaves them out, for a chart too narrow for words) and the
   * largest size for the powers of ten under them (0 leaves them out). Powers are set as large
   * as the columns allow, up to that size, so the small raised power stays readable.
   */
  nameSize: number;
  powerSize: number;
  digitSize: number;
  /** No column is wider than this. */
  maxColumn: number;
}

export interface PlaceValueChart {
  elements: SceneElement[];
  /** The digit cell for a power of ten, and its id (a digit sits inside it). */
  cell: (power: number) => Rect;
  cellId: (power: number) => string;
  box: Rect;
}

const PLACE_NAMES: Record<number, string> = {
  3: "thousands",
  2: "hundreds",
  1: "tens",
  0: "ones",
  [-1]: "tenths",
  [-2]: "hundredths",
  [-3]: "thousandths",
  [-4]: "ten-thousandths",
  [-5]: "hundred-thousandths",
  [-6]: "millionths",
};

/** The place name for a power of ten: 0 is "ones", -1 is "tenths". */
export function placeName(power: number): string {
  const name = PLACE_NAMES[power];
  if (!name) throw new Error(`No place name for 10 to the power ${power}`);
  return name;
}

/** 10 to a power, as a maths label. */
export function powerOfTen(power: number): MathNode[] {
  return [{ pow: [[{ num: "10" }], [{ num: String(power) }]] }];
}

/** A place name on one line, or broken after its hyphen when one line is too wide. */
function nameLines(name: string, size: number, width: number): string[] {
  const hyphen = name.indexOf("-");
  if (measureText(name, size).w <= width || hyphen < 0) return [name];
  return [name.slice(0, hyphen + 1), name.slice(hyphen + 1)];
}

export function placeValueChart(options: PlaceValueOptions): PlaceValueChart {
  const { id, region, high, low, nameSize, digitSize } = options;
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || low > -1 || high <= low) {
    throw new Error("A place-value chart runs from the ones or above to the tenths or below");
  }
  const count = high - low + 1;
  const width = Math.min(options.maxColumn, region.width / count);
  const left = region.x + (region.width - width * count) / 2;
  const column = (power: number) => high - power;
  const powers = Array.from({ length: count }, (_, i) => high - i);

  // Headings: up to two lines of place name, then the power of ten.
  const room = width - 2 * nameSize * 0.08;
  // The widest power is the last column's (the longest negative power), with 7% of the column
  // clear on each side of it.
  const powerSize = Math.min(
    options.powerSize,
    (width * 0.86) / measureMaths(powerOfTen(low), 1).w,
  );
  const pad = Math.max(nameSize, powerSize) * 0.2;
  const names = new Map(
    powers.map((power) => [power, nameSize ? nameLines(placeName(power), nameSize, room) : []]),
  );
  const nameRows = Math.max(...[...names.values()].map((lines) => lines.length));
  const namesHeight = nameRows * LINE_HEIGHT * nameSize;
  const powerHeight = powerSize ? measureMaths(powerOfTen(low), powerSize).h : 0;
  const between = nameSize && powerSize ? pad * 0.5 : 0;
  const headHeight = 2 * pad + namesHeight + between + powerHeight;
  const cellHeight = digitSize * 1.6;
  const top = region.y;
  const head = (power: number): Rect => ({
    x: left + column(power) * width,
    y: top,
    width,
    height: headHeight,
  });
  const cell = (power: number): Rect => ({
    x: left + column(power) * width,
    y: top + headHeight,
    width,
    height: cellHeight,
  });
  const cellId = (power: number) => `${id}.cell.${column(power)}`;

  const elements: SceneElement[] = [];
  for (const power of powers) {
    const [h, c] = [head(power), cell(power)];
    const headId = `${id}.head.${column(power)}`;
    const cx = h.x + h.width / 2;
    elements.push({
      id: headId,
      role: "structure",
      type: "rect",
      x: h.x,
      y: h.y,
      w: h.width,
      h: h.height,
    });
    const lines = names.get(power) ?? [];
    if (lines.length) {
      // A one-line name sits in the middle of the space two lines would take.
      const lineWidth = Math.max(...lines.map((line) => measureText(line, nameSize).w));
      const height = lines.length * LINE_HEIGHT * nameSize;
      const y = h.y + pad + (namesHeight - height) / 2;
      const name: TextElement = {
        id: `${id}.name.${column(power)}`,
        role: "structure",
        type: "text",
        x: cx - lineWidth / 2,
        y,
        w: lineWidth,
        h: height,
        size: nameSize,
        font: "body",
        align: "middle",
        text: lines.join("\n"),
        inside: headId,
      };
      elements.push(name);
    }
    if (powerSize) {
      elements.push(
        text(
          `${id}.power.${column(power)}`,
          "structure",
          powerOfTen(power),
          cx,
          h.y + h.height - pad - powerHeight / 2,
          {
            size: powerSize,
            inside: headId,
          },
        ),
      );
    }
    elements.push({
      id: cellId(power),
      role: "structure",
      type: "rect",
      x: c.x,
      y: c.y,
      w: c.width,
      h: c.height,
    });
  }
  // The decimal point sits on the line between the ones and the tenths, low in the digit row.
  const ones = cell(0);
  elements.push({
    id: `${id}.point`,
    role: "given",
    type: "circle",
    cx: ones.x + ones.width,
    cy: ones.y + ones.height * 0.72,
    r: digitSize * 0.13,
    fill: true,
  });
  return {
    elements,
    cell,
    cellId,
    box: { x: left, y: top, width: width * count, height: headHeight + cellHeight },
  };
}

/** A digit centred in the cell for its power of ten. */
export function digitIn(
  chart: PlaceValueChart,
  id: string,
  digit: string,
  power: number,
  role: Role,
  size: number,
): TextElement {
  const box = chart.cell(power);
  return text(id, role, digit, box.x + box.width / 2, box.y + box.height / 2, {
    size,
    inside: chart.cellId(power),
  });
}
