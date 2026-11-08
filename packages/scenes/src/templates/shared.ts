import type { JsonValue } from "@eddy/schemas";
import type { Region, SceneFormat } from "../canvas";
import type { ItemParams } from "./template";
import { formatNumber } from "../layout/format";

/** Working text and labels, in canvas units: both clear the minimum size in either format. */
export const WORKING = 44;
export const LABEL = 40;

/** A template's regions for each format, as fractions of the safe area. */
export function layoutFor<K extends string>(
  regions: Record<SceneFormat, Record<K, Region>>,
): Record<SceneFormat, Record<K, Region>> {
  return regions;
}

function value(item: ItemParams, key: string): JsonValue {
  if (!(key in item)) throw new Error(`Missing parameter ${key}`);
  return item[key] as JsonValue;
}

/** A whole-number parameter within [min, max]. */
export function integer(item: ItemParams, key: string, min: number, max: number): number {
  const raw = value(item, key);
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new Error(`Parameter ${key} must be a whole number from ${min} to ${max}`);
  }
  return raw;
}

/** A decimal parameter written as a string ("0.397"), within [min, max]. */
export function decimal(item: ItemParams, key: string, min: number, max: number): string {
  const raw = value(item, key);
  if (typeof raw !== "string" || !/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Parameter ${key} must be a decimal written as text`);
  }
  const number = Number(raw);
  if (number < min || number > max)
    throw new Error(`Parameter ${key} must be from ${min} to ${max}`);
  return raw;
}

export function oneOf<T extends string>(item: ItemParams, key: string, options: readonly T[]): T {
  const raw = value(item, key);
  if (typeof raw !== "string" || !options.includes(raw as T)) {
    throw new Error(`Parameter ${key} must be one of ${options.join(", ")}`);
  }
  return raw as T;
}

export function integers(
  item: ItemParams,
  key: string,
  min: number,
  max: number,
  length: [number, number],
): number[] {
  const raw = value(item, key);
  if (!Array.isArray(raw) || raw.length < length[0] || raw.length > length[1]) {
    throw new Error(`Parameter ${key} must be a list of ${length[0]} to ${length[1]} numbers`);
  }
  return raw.map((entry, i) =>
    integer({ [`${key}.${i}`]: entry as JsonValue }, `${key}.${i}`, min, max),
  );
}

/** Greatest common divisor, always positive. */
export function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/** "6 up" or "6 down" for a signed vertical move. */
export function upOrDown(dy: number): string {
  return dy > 0 ? `${formatNumber(dy)} up` : `${formatNumber(-dy)} down`;
}

/**
 * Remembers the last few results of an expensive, pure computation by key. `draw` runs once per
 * beat with the same geometry, so heavy templates work it out once per scene and format.
 */
export function memoise<T>(compute: (key: string) => T, size = 16): (key: string) => T {
  const recent = new Map<string, T>();
  return (key) => {
    let value = recent.get(key);
    if (value === undefined) {
      value = compute(key);
      if (recent.size >= size) recent.delete(recent.keys().next().value as string);
      recent.set(key, value);
    }
    return value;
  };
}
