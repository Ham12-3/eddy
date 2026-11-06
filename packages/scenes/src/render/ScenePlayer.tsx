"use client";

import { CaptionsPanel, PlayerControls, type PlaybackSpeed } from "@eddy/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { SCENE_FORMATS } from "../canvas";
import type { BuiltScene } from "../templates/template";
import { beatAt, beatTimings, frameAt, totalDuration } from "../timeline/timeline";
import { SceneCanvas } from "./SceneCanvas";
import { SceneErrorBoundary } from "./SceneErrorBoundary";

/**
 * Plays a scene (SPEC.md section 8.4, ADR-0027). It never starts on its own: it opens paused on
 * the first beat. Controls: play and pause, step back and forward one beat, replay, speed,
 * captions and transcript. Keyboard on the scene: Space or K plays and pauses, the arrow keys
 * step, R replays. With reduced motion each beat cross-fades in 150 ms and nothing moves.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** The longest step the clock takes in one animation frame. */
export const MAX_FRAME_MS = 100;

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export interface ScenePlayerProps {
  scene: BuiltScene;
  /** The in-app setting; when left out, the system preference decides. */
  reducedMotion?: boolean;
}

export function ScenePlayer(props: ScenePlayerProps): ReactElement {
  return (
    <SceneErrorBoundary narrations={props.scene.spec.beats.map((beat) => beat.narration)}>
      <Player {...props} />
    </SceneErrorBoundary>
  );
}

function Player({ scene, reducedMotion }: ScenePlayerProps): ReactElement {
  const systemReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? systemReduced;
  const narrations = useMemo(() => scene.spec.beats.map((beat) => beat.narration), [scene]);
  const timings = useMemo(
    () => beatTimings(narrations, { reducedMotion: reduced }),
    [narrations, reduced],
  );
  const total = totalDuration(timings);
  const last = timings.length - 1;

  const [time, setTimeState] = useState(() => timings[0]?.settled ?? 0);
  const timeRef = useRef(time);
  const stopAt = useRef(total);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [captions, setCaptions] = useState(true);
  const [transcript, setTranscript] = useState(false);

  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  const setTime = useCallback((next: number) => {
    timeRef.current = next;
    setTimeState(next);
  }, []);

  // Switching motion settings keeps the reader on the same beat, settled and paused.
  const [timingsSeen, setTimingsSeen] = useState(timings);
  if (timingsSeen !== timings) {
    const beatThen = beatAt(timingsSeen, time);
    setTimingsSeen(timings);
    setTimeState(timings[beatThen]?.settled ?? 0);
    setPlaying(false);
  }

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous: number | undefined;
    const tick = (now: number) => {
      if (previous !== undefined) {
        // A background tab pauses animation frames; cap each step so returning does not skip
        // to the end of the scene.
        const step = Math.min(now - previous, MAX_FRAME_MS) * speed;
        const next = Math.min(timeRef.current + step, stopAt.current);
        setTime(next);
        if (next >= stopAt.current) {
          setPlaying(false);
          return;
        }
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, setTime]);

  const beat = beatAt(timings, time);
  const atEnd = time >= total - 1;

  const playPause = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (atEnd) setTime(0);
    stopAt.current = total;
    setPlaying(true);
  };
  const replay = () => {
    setTime(0);
    stopAt.current = total;
    setPlaying(true);
  };
  const stepBack = () => {
    setPlaying(false);
    setTime(timings[Math.max(0, beat - 1)]?.settled ?? 0);
  };
  const stepForward = () => {
    if (beat >= last) return;
    setTime(timings[beat + 1]?.start ?? total);
    stopAt.current = timings[beat + 1]?.settled ?? total;
    setPlaying(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    // Leave browser and system shortcuts (Ctrl+R, Alt+Left) alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const actions: Record<string, () => void> = {
      " ": playPause,
      k: playPause,
      ArrowRight: stepForward,
      ArrowLeft: stepBack,
      r: replay,
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const stepLabel = `Step ${beat + 1} of ${timings.length}`;
  return (
    <section aria-label={scene.template.title} className="flex flex-col gap-3">
      <div className="eddy-scene">
        <div
          tabIndex={0}
          role="group"
          aria-roledescription="animated explanation"
          aria-label={`${scene.template.title}. ${stepLabel}. Space plays or pauses, the arrow keys step.`}
          onKeyDown={onKeyDown}
          className="rounded-card outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          {SCENE_FORMATS.map((format) => (
            <SceneCanvas
              key={format}
              layout={scene.layouts[format]}
              drawn={frameAt(scene.layouts[format], timings, time, { reducedMotion: reduced })}
            />
          ))}
        </div>
      </div>
      <PlayerControls
        playing={playing}
        onPlayPause={playPause}
        onReplay={replay}
        onStepBack={stepBack}
        onStepForward={stepForward}
        canStepBack={beat > 0}
        canStepForward={beat < last}
        stepLabel={stepLabel}
        speed={speed}
        onSpeedChange={setSpeed}
        captions={captions}
        onCaptionsChange={setCaptions}
        transcript={transcript}
        onTranscriptChange={setTranscript}
      />
      <CaptionsPanel
        current={narrations[beat] ?? ""}
        transcript={narrations}
        activeIndex={beat}
        showCaptions={captions}
        showTranscript={transcript}
      />
    </section>
  );
}
