import type { Rect } from "../canvas";
import { formatNumber } from "../layout/format";
import { text } from "../layout/geometry";
import type { RectElement, SceneElement, TextElement } from "../layout/types";

/**
 * Data chart: a list of values as number cards in a row, the way a student lays them out to put
 * them in order. Cards share one width (the widest number's, within the room there is) and the
 * row is centred.
 */

export interface CardRowOptions {
  id: string;
  /** The row's band: cards fill its height, centred across its width. */
  band: Rect;
  values: readonly number[];
  size: number;
  /** The widest a card may be. */
  maxWidth?: number;
  /** The space wanted between cards; less when the row would not fit. */
  gap?: number;
}

export interface Card {
  box: RectElement;
  value: TextElement;
}

export interface CardRow {
  elements: SceneElement[];
  cards: Card[];
  /** The whole row's extent. */
  box: Rect;
}

export function cardRow(options: CardRowOptions): CardRow {
  const { id, band, values, size } = options;
  const count = values.length;
  const wanted = options.gap ?? size * 0.4;
  const widest = options.maxWidth ?? Infinity;
  // The wanted gap if the cards still fit at their widest, else a gap that leaves them room.
  const gap =
    count * Math.min(widest, band.width) + (count - 1) * wanted <= band.width
      ? wanted
      : Math.min(size * 0.4, band.width / (count * 6));
  const room = (band.width - gap * (count - 1)) / count;
  const width = Math.min(room, widest);
  const total = width * count + gap * (count - 1);
  const left = band.x + (band.width - total) / 2;
  const cards = values.map((value, i): Card => {
    const box: RectElement = {
      id: `${id}.card.${i}`,
      role: "structure",
      type: "rect",
      x: left + i * (width + gap),
      y: band.y,
      w: width,
      h: band.height,
    };
    return {
      box,
      value: text(
        `${id}.value.${i}`,
        "given",
        formatNumber(value),
        box.x + width / 2,
        box.y + box.h / 2,
        {
          size,
          inside: box.id,
        },
      ),
    };
  });
  return {
    elements: cards.flatMap((card) => [card.box, card.value]),
    cards,
    box: { x: left, y: band.y, width: total, height: band.height },
  };
}
