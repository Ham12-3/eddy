/**
 * Hand-drawn line icons. Decorative: always paired with visible text or an aria-label.
 * No emoji and no glittery "AI" decoration (see the cliche lint).
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const TickIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 10.5l4 4 8-9" />
  </Icon>
);

/** A teacher's wavy underline: "look again here". */
export const SlipIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0" />
    <path d="M10 3.5v4" />
  </Icon>
);

export const HintIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.2-.8.7-.8 1.2v.5" />
    <path d="M10 14h.01" />
  </Icon>
);

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 9v5" />
    <path d="M10 6h.01" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Icon>
);

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 4l10 6-10 6z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 4.5v11M13.5 4.5v11" strokeWidth={2.5} />
  </Icon>
);

export const StepBackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4.5v11" />
    <path d="M15 4.5l-7 5.5 7 5.5z" fill="currentColor" />
  </Icon>
);

export const StepForwardIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 4.5v11" />
    <path d="M5 4.5l7 5.5-7 5.5z" fill="currentColor" />
  </Icon>
);

export const ReplayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 10a6 6 0 1 0 2-4.5" />
    <path d="M4 3.5v3h3" />
  </Icon>
);

export const CaptionsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
    <path d="M6 11.5h3M11 11.5h3M6 8.5h8" />
  </Icon>
);

export const TranscriptIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 5h10M5 8.5h10M5 12h7M5 15.5h5" />
  </Icon>
);

/** A small speaker: narration read aloud. */
export const VoiceIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8v4h3l4 3.5v-11L6 8H3z" />
    <path d="M13 7.5a3.5 3.5 0 0 1 0 5" />
    <path d="M15.5 5a7 7 0 0 1 0 10" />
  </Icon>
);

/** Three short exercise-book lines, for empty states. */
export const RuledLinesIcon = (props: IconProps) => (
  <Icon width={40} height={40} {...props}>
    <path d="M2 6h16M2 10h16M2 14h10" strokeWidth={1.25} />
  </Icon>
);
