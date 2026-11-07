import { describe, expect, it } from "vitest";
import { pickVoice, speakable, speechTimeoutMs, synthVoice } from "./voice";

const voice = (name: string, lang: string, localService: boolean) =>
  ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

describe("choosing the device voice", () => {
  it("prefers a British voice on the device", () => {
    const voices = [
      voice("Online UK", "en-GB", false),
      voice("US", "en-US", true),
      voice("UK", "en-GB", true),
    ];
    expect(pickVoice(voices)?.name).toBe("UK");
  });

  it("falls back to any English voice on the device", () => {
    expect(pickVoice([voice("Online UK", "en-GB", false), voice("US", "en_US", true)])?.name).toBe(
      "US",
    );
  });

  it("never uses a voice that sends text off the device", () => {
    expect(pickVoice([voice("Online UK", "en-GB", false), voice("French", "fr-FR", true)])).toBe(
      null,
    );
  });

  it("waits longer for longer lines and slower speeds, never less than 4 seconds", () => {
    expect(speechTimeoutMs("Hi.", 1)).toBe(4000);
    const line = "word ".repeat(20);
    expect(speechTimeoutMs(line, 0.75)).toBeGreaterThan(speechTimeoutMs(line, 1.25));
  });
});

describe("narration as a voice says it", () => {
  const minus = String.fromCodePoint(0x2212);
  it("reads signs, fractions, powers and symbols as words", () => {
    expect(speakable(`Which is smaller: ${minus}8 or ${minus}2?`)).toBe(
      "Which is smaller: negative 8 or negative 2?",
    );
    expect(speakable(`6x ${minus} 5 = 13`)).toBe("6x minus 5 equals 13");
    expect(speakable("3/5 times 5/8 is 15/40.")).toBe("3 over 5 times 5 over 8 is 15 over 40.");
    expect(
      speakable(
        `12${String.fromCodePoint(0xb2)} + 9${String.fromCodePoint(0xb2)} = 225 cm${String.fromCodePoint(0xb2)}`,
      ),
    ).toBe("12 squared + 9 squared equals 225 square cm");
    expect(speakable(`89${String.fromCodePoint(0xb0)} ${String.fromCodePoint(0xd7)} 2`)).toBe(
      "89 degrees times 2",
    );
  });
});

describe("the synthesiser voice", () => {
  function fakeSynth() {
    const spoken: SpeechSynthesisUtterance[] = [];
    return {
      spoken,
      synth: { speak: (u: SpeechSynthesisUtterance) => spoken.push(u), cancel: () => {} },
      make: (text: string) => ({ text }) as SpeechSynthesisUtterance,
    };
  }
  const uk = voice("UK", "en-GB", true);
  const event = {} as SpeechSynthesisEvent;
  const errorEvent = {} as SpeechSynthesisErrorEvent;

  it("settles each line once, so a cancelled line's late event cannot end the next", () => {
    const { synth, make, spoken } = fakeSynth();
    const narrator = synthVoice(synth, make, uk);
    const done: string[] = [];
    narrator.speak("first", 1, () => done.push("first"));
    narrator.speak("second", 1, () => done.push("second"));
    expect(done).toEqual(["first"]); // cut short by the second line
    spoken[0]!.onerror?.call(spoken[0]!, errorEvent); // the late "interrupted" event
    spoken[0]!.onend?.call(spoken[0]!, event);
    expect(done).toEqual(["first"]);
    spoken[1]!.onend?.call(spoken[1]!, event);
    expect(done).toEqual(["first", "second"]);
    expect(spoken[1]!.voice).toBe(uk);
  });

  it("stop settles the line in progress", () => {
    const { synth, make } = fakeSynth();
    const narrator = synthVoice(synth, make, uk);
    let ended = 0;
    narrator.speak("line", 1.25, () => (ended += 1));
    narrator.stop();
    narrator.stop();
    expect(ended).toBe(1);
  });
});
