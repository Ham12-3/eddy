import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { ConfidencePicker, type Confidence } from "../components/ConfidencePicker";
import { Feedback } from "../components/Feedback";
import { TextField } from "../components/Fields";
import { Link } from "../components/Link";
import { Maths } from "../components/Maths";
import { CaptionsPanel, PlayerControls } from "../components/Player";
import { ProgressMapNode } from "../components/ProgressMapNode";
import { QuestionCard } from "../components/QuestionCard";
import { EmptyState } from "../components/States";
import { Toggle } from "../components/Toggle";
import { WorkingPad } from "../components/WorkingPad";

/**
 * Every component on one page, for reviewing the design system at a glance in each mode
 * (screenshots at 375, 768 and 1280 px; light, dark, reduced motion and dyslexia).
 */
const meta = {
  title: "Design system/Gallery",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Everything: Story = {
  render: function GalleryStory() {
    const [confidence, setConfidence] = useState<Confidence | null>(2);
    const [captionsOnly, setCaptionsOnly] = useState(false);
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10 md:px-10">
        <header className="flex flex-col gap-3">
          <p className="m-0 small-caps font-semibold text-ink-muted">Design system</p>
          <h1 className="m-0">Paper and Ink</h1>
          <p className="m-0 max-w-prose text-lead">
            A calm, editorial exercise book. The student&apos;s own working is always{" "}
            <span className="text-student">this colour</span>, the corrected idea{" "}
            <span className="text-correct">this one</span>, and a slip{" "}
            <span className="text-misconception">this one</span>.{" "}
            <mark className="bg-highlight text-ink">Highlighter</mark> sits behind ink only.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="m-0">A question</h2>
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="flex flex-col gap-5">
              <QuestionCard number={3} commandWord="Work out" marks={2} calculator={false}>
                <p className="m-0">
                  Share <Maths latex="\text{£}45" /> in the ratio <Maths latex="2 : 3" />.
                </p>
              </QuestionCard>
              <ConfidencePicker value={confidence} onChange={setConfidence} />
              <div className="flex flex-wrap gap-3">
                <Button variant="accent">Check my answer</Button>
                <Button variant="secondary">Show a hint</Button>
                <Button variant="quiet">Skip for now</Button>
              </div>
            </div>
            <WorkingPad
              lines={[
                <Maths key="1" latex="45 \div 2 = 22.5" tone="student" />,
                <Maths key="2" latex="45 \div 3 = 15" tone="student" />,
              ]}
            />
          </div>
          <Feedback kind="misconception">
            You divided by each part of the ratio. First find the total number of parts:{" "}
            <Maths latex="2 + 3 = 5" />.
          </Feedback>
          <Feedback kind="correct">
            <Maths latex="45 \div 5 = 9" tone="correct" />, so the shares are{" "}
            <Maths latex="\text{£}18" tone="correct" /> and{" "}
            <Maths latex="\text{£}27" tone="correct" />.
          </Feedback>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="m-0">The explanation player</h2>
          <PlayerControls
            playing={false}
            onPlayPause={() => {}}
            onReplay={() => {}}
            onStepBack={() => {}}
            onStepForward={() => {}}
            stepLabel="Step 3 of 6"
            speed={1}
            onSpeedChange={() => {}}
            captions
            onCaptionsChange={() => {}}
            transcript={false}
            onTranscriptChange={() => {}}
          />
          <CaptionsPanel current="Check: £22.50 plus £15 is £37.50, not £45." />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="m-0">Progress</h2>
          <div className="flex flex-wrap gap-6">
            <ProgressMapNode title="Negative numbers" state="secure" />
            <ProgressMapNode title="Ratio" state="learning" />
            <ProgressMapNode title="Percentages" state="needs-review" />
            <ProgressMapNode title="Pythagoras" state="not-started" />
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <Card as="section" className="flex flex-col gap-4">
            <h2 className="m-0 text-h3">Settings</h2>
            <TextField label="First name" hint="Only you and Eddy see this." />
            <Toggle
              label="Captions only"
              description="Read along instead of listening."
              checked={captionsOnly}
              onChange={setCaptionsOnly}
            />
            <div className="flex flex-wrap gap-2">
              <Chip>AQA</Chip>
              <Chip selected onClick={() => {}}>
                Foundation
              </Chip>
            </div>
            <p className="m-0">
              Need to talk to someone? <Link href="#support">Support and safeguarding</Link>
            </p>
          </Card>
          <EmptyState
            title="No reviews due"
            action={<Button variant="secondary">Practise something new</Button>}
          >
            Your next review is on Thursday.
          </EmptyState>
        </section>
      </main>
    );
  },
};
