/** @jsxRuntime automatic */
import katex from "katex";
import type { CSSProperties, ReactElement } from "react";
import { FILL_TINT, HIGHLIGHT_WASH } from "../canvas";
import { KATEX_OPTIONS, mathsToTex } from "../layout/measure";
import type { Role, SceneElement, SceneLayout, TextElement } from "../layout/types";
import type { Drawn } from "../timeline/timeline";

/**
 * Draws one moment of a scene: shapes as SVG, every word as real DOM text (SPEC.md section 8.4).
 * Positions are percentages of the canvas and font sizes are container query units, so the scene
 * scales to its container with no measuring in the browser. Colour comes only from roles.
 */

const ROLE_COLOUR: Record<Role, string> = {
  given: "var(--ink)",
  student: "var(--student)",
  misconception: "var(--misconception)",
  correct: "var(--correct)",
  highlight: "var(--highlight)",
  structure: "var(--ink-muted)",
};

function colour(element: SceneElement): string {
  if (element.layer === "background") return "var(--rule)";
  return ROLE_COLOUR[element.role];
}

const RULE_SPACING = 60;

const STROKE = 4;
const PEN = 6;

function point(cx: number, cy: number, r: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [cx + r * Math.cos(radians), cy - r * Math.sin(radians)];
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  const a = [x2 - size * Math.cos(angle - spread), y2 - size * Math.sin(angle - spread)];
  const b = [x2 - size * Math.cos(angle + spread), y2 - size * Math.sin(angle + spread)];
  return `${x2},${y2} ${a[0]},${a[1]} ${b[0]},${b[1]}`;
}

function Shape({
  element,
  opacity,
}: {
  element: SceneElement;
  opacity: number;
}): ReactElement | null {
  const stroke = colour(element);
  const common = { opacity, "data-element-id": element.id } as const;
  switch (element.type) {
    case "line": {
      const width = element.width ?? STROKE;
      return (
        <g {...common}>
          <line
            x1={element.x1}
            y1={element.y1}
            x2={element.x2}
            y2={element.y2}
            stroke={stroke}
            strokeWidth={width}
            strokeLinecap="round"
            strokeDasharray={element.dash ? `${width * 3} ${width * 2.5}` : undefined}
          />
          {element.arrow ? (
            <polygon
              points={arrowHead(element.x1, element.y1, element.x2, element.y2, width * 5)}
              fill={stroke}
            />
          ) : null}
        </g>
      );
    }
    case "rect":
      if (element.role === "highlight") {
        // A highlighter stroke: a wash with no outline, light enough that text on it keeps its contrast.
        return (
          <rect
            {...common}
            x={element.x}
            y={element.y}
            width={element.w}
            height={element.h}
            rx={6}
            fill={stroke}
            fillOpacity={HIGHLIGHT_WASH}
          />
        );
      }
      return (
        <rect
          {...common}
          x={element.x}
          y={element.y}
          width={element.w}
          height={element.h}
          fill={element.fill ? stroke : "none"}
          fillOpacity={element.fill ? FILL_TINT : undefined}
          stroke={stroke}
          strokeWidth={STROKE}
        />
      );
    case "polygon": {
      const points = element.points.join(" ");
      // SVG turns clockwise for positive angles; scene turns are anticlockwise on screen.
      const transform = element.turn
        ? `rotate(${-element.turn.degrees} ${element.turn.cx} ${element.turn.cy})`
        : undefined;
      return element.open ? (
        <polyline
          {...common}
          points={points}
          transform={transform}
          fill="none"
          stroke={stroke}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
      ) : (
        <polygon
          {...common}
          points={points}
          transform={transform}
          fill={element.fill ? stroke : "none"}
          fillOpacity={element.fill ? (element.role === "structure" ? 1 : FILL_TINT) : undefined}
          stroke={stroke}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
      );
    }
    case "circle":
      return (
        <circle
          {...common}
          cx={element.cx}
          cy={element.cy}
          r={element.r}
          fill={element.fill ? stroke : "none"}
          stroke={stroke}
          strokeWidth={STROKE}
        />
      );
    case "arc": {
      const [x1, y1] = point(element.cx, element.cy, element.r, element.from);
      const [x2, y2] = point(element.cx, element.cy, element.r, element.to);
      const large = Math.abs(element.to - element.from) > 180 ? 1 : 0;
      return (
        <path
          {...common}
          d={`M ${x1} ${y1} A ${element.r} ${element.r} 0 ${large} 0 ${x2} ${y2}`}
          fill="none"
          stroke={stroke}
          strokeWidth={STROKE}
        />
      );
    }
    case "mark":
      return <Mark element={element} stroke={stroke} opacity={opacity} />;
    case "text":
      return null;
  }
}

/** Teacher's-pen marks, drawn slightly by hand so they read as annotations. */
function Mark({
  element,
  stroke,
  opacity,
}: {
  element: Extract<SceneElement, { type: "mark" }>;
  stroke: string;
  opacity: number;
}): ReactElement {
  const { x, y, w, h } = element;
  const props = {
    opacity,
    "data-element-id": element.id,
    fill: "none",
    stroke,
    strokeWidth: PEN,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (element.kind) {
    case "strike":
      return (
        <path
          {...props}
          d={`M ${x} ${y + h * 0.58} Q ${x + w / 2} ${y + h * 0.42} ${x + w} ${y + h * 0.5}`}
        />
      );
    case "cross":
      return (
        <path
          {...props}
          d={`M ${x} ${y} L ${x + w} ${y + h} M ${x + w} ${y + h * 0.05} L ${x + w * 0.05} ${y + h}`}
        />
      );
    case "tick":
      return (
        <path {...props} d={`M ${x} ${y + h * 0.55} L ${x + w * 0.38} ${y + h} L ${x + w} ${y}`} />
      );
    case "underline":
      return (
        <path
          {...props}
          d={`M ${x} ${y + h} Q ${x + w * 0.25} ${y + h - 6} ${x + w * 0.5} ${y + h} T ${x + w} ${y + h}`}
        />
      );
    case "ring":
      return (
        <ellipse
          {...props}
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2}
          ry={h / 2}
          transform={`rotate(-4 ${x + w / 2} ${y + h / 2})`}
        />
      );
  }
}

// KaTeX output by source: labels repeat in every frame, and the player redraws at 60 fps.
const MATHS_CACHE = new Map<string, string>();
const MATHS_CACHE_SIZE = 500;

function renderMaths(tex: string): string {
  let html = MATHS_CACHE.get(tex);
  if (html === undefined) {
    html = katex.renderToString(tex, KATEX_OPTIONS);
    if (MATHS_CACHE.size >= MATHS_CACHE_SIZE) MATHS_CACHE.clear();
    MATHS_CACHE.set(tex, html);
  }
  return html;
}

function SceneText({
  element,
  opacity,
  width,
  height,
}: {
  element: TextElement;
  opacity: number;
  width: number;
  height: number;
}): ReactElement {
  const style: CSSProperties = {
    left: `${(element.x / width) * 100}%`,
    top: `${(element.y / height) * 100}%`,
    width: `${(element.w / width) * 100}%`,
    height: `${(element.h / height) * 100}%`,
    fontSize: `calc(${element.size} / ${width} * 100cqw)`,
    textAlign: element.align === "middle" ? "center" : element.align === "end" ? "right" : "left",
    color: element.role === "highlight" ? "var(--ink)" : ROLE_COLOUR[element.role],
    background: element.role === "highlight" ? "var(--highlight)" : undefined,
    opacity,
  };
  const className = `eddy-scene-text${element.font === "pen" ? " eddy-scene-pen" : ""}`;
  if (element.maths) {
    // KaTeX sets its own struts, so the glyphs are centred in the measured box rather than hung
    // from its top: a power or a fraction then stays inside the box the layout reserved.
    style.display = "flex";
    style.alignItems = "center";
    style.justifyContent =
      element.align === "middle" ? "center" : element.align === "end" ? "flex-end" : "flex-start";
    const html = renderMaths(mathsToTex(element.maths));
    return (
      <div
        className={className}
        style={style}
        data-element-id={element.id}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <div className={className} style={style} data-element-id={element.id}>
      {element.text}
    </div>
  );
}

const LAYER_ORDER = (item: Drawn): number => {
  const { element } = item;
  if (element.layer === "background") return 0;
  if (element.role === "highlight") return 1;
  if (element.type === "mark") return 3;
  return 2;
};

export interface SceneCanvasProps {
  layout: SceneLayout;
  drawn: Drawn[];
}

export function SceneCanvas({ layout, drawn }: SceneCanvasProps): ReactElement {
  const { width, height } = layout;
  const shapes = drawn
    .filter((item) => item.element.type !== "text")
    .sort((a, b) => LAYER_ORDER(a) - LAYER_ORDER(b));
  const texts = drawn.filter(
    (item): item is Drawn & { element: TextElement } => item.element.type === "text",
  );
  const rules = Array.from(
    { length: Math.floor(height / RULE_SPACING) },
    (_, i) => (i + 1) * RULE_SPACING,
  );
  return (
    <div
      className="eddy-scene-canvas"
      data-format={layout.format}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
        className="eddy-scene-svg"
      >
        {rules.map((y) => (
          <line key={y} x1={0} y1={y} x2={width} y2={y} stroke="var(--rule)" strokeWidth={2} />
        ))}
        {shapes.map((item) => (
          <Shape key={item.key} element={item.element} opacity={item.opacity} />
        ))}
      </svg>
      {texts.map((item) => (
        <SceneText
          key={item.key}
          element={item.element}
          opacity={item.opacity}
          width={width}
          height={height}
        />
      ))}
    </div>
  );
}
