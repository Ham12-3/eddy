"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * The device's own voice (ADR-0029): the browser's speech synthesis, with voices that run on the
 * device only (`localService`), so narration text never leaves it. British English first, then
 * any English voice; with none, there is no voice and captions carry the scene.
 *
 * Behind this small interface, so a paid voice (ADR-0011) can replace it without touching scenes.
 */
export interface NarrationVoice {
  /** Speaks one line; `onDone` runs when it ends, fails or is cut short by `stop`. */
  speak(text: string, rate: number, onDone: () => void): void;
  stop(): void;
}

const MINUS = String.fromCodePoint(0x2212);
const SPOKEN: [RegExp, string][] = [
  // A minus sign touching a number is a sign; with a space after it, a subtraction.
  [new RegExp(`${MINUS}(?=\\d)`, "g"), "negative "],
  [new RegExp(`${MINUS} `, "g"), "minus "],
  [/(\d+)\/(\d+)/g, "$1 over $2"],
  [/(\d)²/g, "$1 squared"],
  [/(\d)³/g, "$1 cubed"],
  [/(cm|mm|m|km)²/g, "square $1"],
  [/°/g, " degrees"],
  [/×/g, " times "],
  [/÷/g, " divided by "],
  [/ = /g, " equals "],
  [/ < /g, " is less than "],
  [/ > /g, " is greater than "],
];

/**
 * Narration as a voice should say it. Device voices read "3/5", "12²" or a minus sign in
 * different ways (a fraction as a date, a minus skipped), and a dropped sign can reverse the
 * meaning, so maths symbols become words. Captions keep the text as written.
 */
export function speakable(text: string): string {
  let spoken = text;
  for (const [pattern, words] of SPOKEN) spoken = spoken.replace(pattern, words);
  return spoken.replace(/\s{2,}/g, " ").trim();
}

/** The longest a line is waited for, in case a browser never reports the end of speech. */
export function speechTimeoutMs(text: string, rate: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(4000, ((words * 600) / rate) * 2);
}

export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const local = voices.filter((voice) => voice.localService);
  const lang = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().replace("_", "-");
  return (
    local.find((voice) => lang(voice) === "en-gb") ??
    local.find((voice) => lang(voice).startsWith("en")) ??
    null
  );
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

/**
 * A voice over a speech synthesiser. Each line settles once: when it ends, fails, times out or is
 * cut short. The cancelled line's late "end" or "interrupted" event belongs to that line alone,
 * so it can never release the hold on the line that replaced it.
 */
export function synthVoice(
  synth: Pick<SpeechSynthesis, "speak" | "cancel">,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
  voice: SpeechSynthesisVoice,
): NarrationVoice {
  let current: (() => void) | null = null;
  return {
    speak(text, rate, onDone) {
      current?.();
      synth.cancel();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current === finish) current = null;
        onDone();
      };
      const timer = setTimeout(finish, speechTimeoutMs(text, rate));
      const utterance = makeUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      utterance.onend = finish;
      utterance.onerror = finish;
      current = finish;
      synth.speak(utterance);
    },
    stop() {
      current?.();
      synth.cancel();
    },
  };
}

/** The device voice, or null when this device has no suitable one (or no speech at all). */
export function useDeviceVoice(): NarrationVoice | null {
  const [chosen, setChosen] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported()) return;
    const synth = window.speechSynthesis;
    // Voices load asynchronously in some browsers: pick again when the list changes, but keep
    // the same voice object when it is the same voice, so a line in progress is not restarted.
    const update = () => {
      const next = pickVoice(synth.getVoices());
      setChosen((previous) =>
        previous && next && previous.voiceURI === next.voiceURI ? previous : next,
      );
    };
    update();
    synth.addEventListener("voiceschanged", update);
    return () => {
      synth.removeEventListener("voiceschanged", update);
      synth.cancel();
    };
  }, []);

  return useMemo(
    () =>
      chosen
        ? synthVoice(
            window.speechSynthesis,
            (text) => new window.SpeechSynthesisUtterance(text),
            chosen,
          )
        : null,
    [chosen],
  );
}
