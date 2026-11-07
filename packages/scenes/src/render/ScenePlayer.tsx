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
import { beatAt, beatPauses, beatTimings, frameAt, totalDuration } from "../timeline/timeline";
import { SceneCanvas } from "./SceneCanvas";
import { SceneErrorBoundary } from "./SceneErrorBoundary";
import { speakable, useDeviceVoice, type NarrationVoice } from "./voice";

/**
 * Plays a scene (SPEC.md section 8.4, ADR-0027). It never starts on its own: it opens paused on
 * the first beat. Controls: play and pause, step back and forward one beat, replay, speed,
 * captions and transcript. Keyboard on the scene: Space or K plays and pauses, the arrow keys
 * step, R replays. With reduced motion each beat cross-fades in 150 ms and nothing moves.
 *
 * Narration is read aloud by the device's own voice when there is one (ADR-0029): only after the
 * student presses play, at the chosen speed, and a beat holds until its line has been spoken.
 * Pausing, stepping and replaying stop the voice. Captions always show the same text.
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
  /** The voice to read narration; the device's own voice when left out, none when null. */
  voice?: NarrationVoice | null;
}

export function ScenePlayer(props: ScenePlayerProps): ReactElement {
  return (
    <SceneErrorBoundary narrations={props.scene.spec.beats.map((beat) => beat.narration)}>
      <Player {...props} />
    </SceneErrorBoundary>
  );
}

function Player({ scene, reducedMotion, voice: givenVoice }: ScenePlayerProps): ReactElement {
  const systemReduced = usePrefersReducedMotion();
  const deviceVoice = useDeviceVoice();
  const voice = givenVoice === undefined ? deviceVoice : givenVoice;
  const reduced = reducedMotion ?? systemReduced;
  const narrations = useMemo(() => scene.spec.beats.map((beat) => beat.narration), [scene]);
  const pauses = useMemo(() => beatPauses(scene.spec.beats.map((beat) => beat.kind)), [scene]);
  const timings = useMemo(
    () => beatTimings(narrations, { reducedMotion: reduced, pauses }),
    [narrations, reduced, pauses],
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
  const [voiceOn, setVoiceOn] = useState(true);
  // The beat whose line was last started, and the beat still being spoken (or -1).
  const spokenBeat = useRef(-1);
  const speaking = useRef(-1);
  const timingsRef = useRef(timings);
  useEffect(() => {
    timingsRef.current = timings;
  }, [timings]);
  const voiceActive = useRef(false);
  useEffect(() => {
    voiceActive.current = Boolean(givenVoice === undefined ? deviceVoice : givenVoice) && voiceOn;
  }, [givenVoice, deviceVoice, voiceOn]);

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
        // While a line is being spoken, its beat holds just before its end.
        const held = speaking.current;
        const hold = held < 0 ? Infinity : (timingsRef.current[held]?.end ?? Infinity) - 1;
        const next = Math.min(
          timeRef.current + step,
          stopAt.current,
          Math.max(hold, timeRef.current),
        );
        // A beat just entered is held from its first frame, before the effect starts its line.
        const entered = beatAt(timingsRef.current, next);
        if (voiceActive.current && speaking.current < 0 && spokenBeat.current !== entered) {
          speaking.current = entered;
        }
        setTime(next);
        if (next >= stopAt.current) {
          // At the very end every line has been spoken: playing again starts afresh.
          if (next >= (timingsRef.current.at(-1)?.end ?? 0)) spokenBeat.current = -1;
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
  // The very end, not the voice hold just before it: pausing while the last line is spoken and
  // pressing play finishes the scene rather than restarting it.
  const atEnd = time >= total;

  const stopVoice = useCallback(() => {
    speaking.current = -1;
    spokenBeat.current = -1;
    voice?.stop();
  }, [voice]);

  // Each beat's line is spoken once as playback reaches it.
  useEffect(() => {
    if (!playing || !voice || !voiceOn || spokenBeat.current === beat) return;
    spokenBeat.current = beat;
    speaking.current = beat;
    voice.speak(speakable(narrations[beat] ?? ""), speed, () => {
      if (speaking.current === beat) speaking.current = -1;
    });
  }, [playing, beat, voice, voiceOn, narrations, speed]);

  // A new scene, a motion switch or leaving the page stops the voice.
  useEffect(() => stopVoice, [stopVoice, timings]);

  const playPause = () => {
    if (playing) {
      setPlaying(false);
      stopVoice();
      return;
    }
    if (atEnd) {
      stopVoice();
      setTime(0);
    }
    stopAt.current = total;
    setPlaying(true);
  };
  const replay = () => {
    stopVoice();
    setTime(0);
    stopAt.current = total;
    setPlaying(true);
  };
  const stepBack = () => {
    stopVoice();
    setPlaying(false);
    setTime(timings[Math.max(0, beat - 1)]?.settled ?? 0);
  };
  const stepForward = () => {
    if (beat >= last) return;
    stopVoice();
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
        voice={voiceOn}
        voiceAvailable={voice !== null}
        onVoiceChange={(on) => {
          if (!on) stopVoice();
          setVoiceOn(on);
        }}
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
