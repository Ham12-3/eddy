import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CaptionsPanel, PlayerControls, type PlaybackSpeed } from "../components/Player";

const meta = { title: "Design system/Player" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NARRATION = [
  "We need to share £45 in the ratio 2 to 3.",
  "You worked out 45 divided by 2, and 45 divided by 3.",
  "Check: £22.50 plus £15 is £37.50, not £45.",
  "Draw the bar. 2 parts plus 3 parts makes 5 equal parts.",
  "£45 shared into 5 parts is £9 for each part.",
  "So 2 parts is £18 and 3 parts is £27.",
];

export const Controls: Story = {
  render: function ControlsStory() {
    const [playing, setPlaying] = useState(false);
    const [step, setStep] = useState(2);
    const [speed, setSpeed] = useState<PlaybackSpeed>(1);
    const [captions, setCaptions] = useState(true);
    const [transcript, setTranscript] = useState(true);
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <PlayerControls
          playing={playing}
          onPlayPause={() => setPlaying(!playing)}
          onReplay={() => setStep(0)}
          onStepBack={() => setStep(Math.max(0, step - 1))}
          onStepForward={() => setStep(Math.min(NARRATION.length - 1, step + 1))}
          canStepBack={step > 0}
          canStepForward={step < NARRATION.length - 1}
          stepLabel={`Step ${step + 1} of ${NARRATION.length}`}
          speed={speed}
          onSpeedChange={setSpeed}
          captions={captions}
          onCaptionsChange={setCaptions}
          transcript={transcript}
          onTranscriptChange={setTranscript}
        />
        <CaptionsPanel
          current={NARRATION[step] ?? ""}
          transcript={NARRATION}
          activeIndex={step}
          showCaptions={captions}
          showTranscript={transcript}
        />
      </div>
    );
  },
};
