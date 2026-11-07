import { cx } from "./cx";
import {
  CaptionsIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
  StepBackIcon,
  StepForwardIcon,
  TranscriptIcon,
  VoiceIcon,
} from "./icons";

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface PlayerControlsProps {
  playing: boolean;
  onPlayPause: () => void;
  onReplay: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  canStepBack?: boolean;
  canStepForward?: boolean;
  /** For example "Step 2 of 6". */
  stepLabel?: string;
  speed: PlaybackSpeed;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  captions: boolean;
  onCaptionsChange: (on: boolean) => void;
  transcript: boolean;
  onTranscriptChange: (on: boolean) => void;
  /**
   * Narration read aloud by the device's own voice (ADR-0029). The toggle appears only when
   * `onVoiceChange` is given; without a voice on the device it reads "No voice" and does nothing.
   */
  voice?: boolean;
  onVoiceChange?: (on: boolean) => void;
  voiceAvailable?: boolean;
}

const iconButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control border border-field-border bg-paper-raised px-3 text-ink hover:bg-paper aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const pressed = "aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper-raised";

/** Controls for an animated explanation (SPEC.md section 8.4). The scene engine wires them up in M5. */
export function PlayerControls({
  playing,
  onPlayPause,
  onReplay,
  onStepBack,
  onStepForward,
  canStepBack = true,
  canStepForward = true,
  stepLabel,
  speed,
  onSpeedChange,
  captions,
  onCaptionsChange,
  transcript,
  onTranscriptChange,
  voice = false,
  onVoiceChange,
  voiceAvailable = true,
}: PlayerControlsProps) {
  return (
    <div
      role="group"
      aria-label="Explanation controls"
      className="flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        aria-label="Replay from the start"
        onClick={onReplay}
        className={iconButton}
      >
        <ReplayIcon />
      </button>
      <button
        type="button"
        aria-label="Previous step"
        // aria-disabled, not disabled: a disabled button would drop the keyboard user's focus
        // when they step to the first beat.
        aria-disabled={!canStepBack}
        onClick={canStepBack ? onStepBack : undefined}
        className={iconButton}
      >
        <StepBackIcon />
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onPlayPause}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control bg-ink text-paper-raised hover:bg-ink/85"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        aria-label="Next step"
        aria-disabled={!canStepForward}
        onClick={canStepForward ? onStepForward : undefined}
        className={iconButton}
      >
        <StepForwardIcon />
      </button>
      {stepLabel ? (
        <span aria-live="polite" className="tabular px-2 text-caption text-ink-muted">
          {stepLabel}
        </span>
      ) : null}
      <div role="group" aria-label="Playback speed" className="ml-auto flex gap-1">
        {PLAYBACK_SPEEDS.map((option) => (
          // The visible text is the name (WCAG 2.5.3); the group says what it is for.
          <button
            key={option}
            type="button"
            aria-pressed={speed === option}
            onClick={() => onSpeedChange(option)}
            className={cx(iconButton, pressed, "tabular px-2 text-caption font-semibold")}
          >
            {option}x
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={captions}
        onClick={() => onCaptionsChange(!captions)}
        className={cx(iconButton, pressed)}
      >
        <CaptionsIcon />
        <span className="text-caption font-semibold">Captions</span>
      </button>
      <button
        type="button"
        aria-pressed={transcript}
        onClick={() => onTranscriptChange(!transcript)}
        className={cx(iconButton, pressed)}
      >
        <TranscriptIcon />
        <span className="text-caption font-semibold">Transcript</span>
      </button>
      {onVoiceChange ? (
        <button
          type="button"
          aria-pressed={voiceAvailable && voice}
          aria-disabled={!voiceAvailable}
          onClick={voiceAvailable ? () => onVoiceChange(!voice) : undefined}
          className={cx(iconButton, pressed)}
        >
          <VoiceIcon />
          <span className="text-caption font-semibold">
            {voiceAvailable ? "Voice" : "No voice"}
          </span>
        </button>
      ) : null}
    </div>
  );
}

export interface CaptionsPanelProps {
  /** The caption for the current beat. */
  current: string;
  transcript?: string[];
  activeIndex?: number;
  showCaptions?: boolean;
  showTranscript?: boolean;
}

/** Captions come from the same text as the narration; the transcript highlights the current line. */
export function CaptionsPanel({
  current,
  transcript = [],
  activeIndex = -1,
  showCaptions = true,
  showTranscript = false,
}: CaptionsPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      {showCaptions ? (
        <p
          aria-live="polite"
          className="m-0 min-h-[2lh] rounded-control bg-ink px-4 py-2 text-center text-lead text-paper-raised"
        >
          {current}
        </p>
      ) : null}
      {showTranscript ? (
        <section
          aria-label="Transcript"
          className="rounded-card border border-rule bg-paper-raised p-4"
        >
          <h3 className="m-0 mb-2 text-body font-semibold">Transcript</h3>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {transcript.map((line, index) => (
              <li
                key={index}
                aria-current={index === activeIndex ? "step" : undefined}
                className={cx(
                  "rounded-control px-2 py-1",
                  index === activeIndex && "bg-highlight text-ink",
                )}
              >
                {line}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
