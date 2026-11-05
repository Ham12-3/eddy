import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import {
  ConfidencePicker,
  type Confidence as ConfidenceValue,
} from "../components/ConfidencePicker";
import { Feedback, LiveRegion } from "../components/Feedback";
import { MathField } from "../components/MathField";
import { Maths } from "../components/Maths";
import { QuestionCard } from "../components/QuestionCard";
import { WorkingPad } from "../components/WorkingPad";

const meta = { title: "Design system/Learning" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Question: Story = {
  render: () => (
    <div className="max-w-2xl">
      <QuestionCard number={3} commandWord="Work out" marks={2} calculator={false}>
        <p className="m-0">
          Share <Maths latex="\text{£}45" /> in the ratio <Maths latex="2 : 3" />.
        </p>
      </QuestionCard>
    </div>
  ),
};

export const MathsByRole: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-2 text-lead">
      <p className="m-0">
        Given: <Maths latex="\frac{1}{2} + \frac{1}{3}" />
      </p>
      <p className="m-0">
        Your answer: <Maths latex="\frac{2}{5}" tone="student" />
      </p>
      <p className="m-0">
        The slip: <Maths latex="\frac{1 + 1}{2 + 3}" tone="misconception" />
      </p>
      <p className="m-0">
        Correct: <Maths latex="\frac{3}{6} + \frac{2}{6} = \frac{5}{6}" tone="correct" />
      </p>
      <Maths display latex="x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}" />
    </div>
  ),
};

/** The maths input. Type with a keyboard: 1/2 becomes a fraction. */
export const MathInput: Story = {
  render: function MathInputStory() {
    const [latex, setLatex] = useState("");
    return (
      <div className="flex max-w-md flex-col gap-3">
        <MathField
          label="Your answer"
          hint="Type / for a fraction, ^ for a power."
          value={latex}
          onChange={setLatex}
        />
        <p className="m-0 text-caption text-ink-muted" data-testid="latex-value">
          LaTeX: {latex || "(empty)"}
        </p>
      </div>
    );
  },
};

export const MathInputWithError: Story = {
  render: () => (
    <div className="max-w-md">
      <MathField label="Your answer" value="\frac{2}{5}" error="Check the denominators." />
    </div>
  ),
};

export const Working: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-6 md:grid-cols-2">
      <WorkingPad lines={[]} />
      <WorkingPad
        lines={[
          <Maths key="1" latex="45 \div 5 = 9" tone="student" />,
          <Maths key="2" latex="2 \times 9 = 18" tone="student" />,
          <Maths key="3" latex="3 \times 9 = 27" tone="student" />,
        ]}
      />
    </div>
  ),
};

export const Confidence: Story = {
  render: function ConfidenceStory() {
    const [value, setValue] = useState<ConfidenceValue | null>(3);
    return (
      <div className="max-w-2xl">
        <ConfidencePicker value={value} onChange={setValue} />
      </div>
    );
  },
};

export const FeedbackKinds: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-3">
      <Feedback kind="correct">
        You found the value of one part first. That is exactly the right strategy.
      </Feedback>
      <Feedback kind="misconception">
        You added the numerators and the denominators. Fractions need a common denominator first.
      </Feedback>
      <Feedback kind="hint">How many equal parts are there altogether?</Feedback>
      <Feedback kind="info">
        Questions like this are often worth 2 marks: show your working.
      </Feedback>
    </div>
  ),
};

/** A whole question as a student meets it. */
export const LearningStep: Story = {
  render: function LearningStepStory() {
    const [confidence, setConfidence] = useState<ConfidenceValue | null>(null);
    const [checked, setChecked] = useState(false);
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <QuestionCard number={1} commandWord="Work out" marks={1} calculator={false}>
          <p className="m-0">
            <Maths latex="\frac{1}{2} + \frac{1}{3}" />
          </p>
        </QuestionCard>
        <MathField label="Your answer" />
        <ConfidencePicker value={confidence} onChange={setConfidence} />
        <div className="flex flex-wrap gap-3">
          <Button variant="accent" onClick={() => setChecked(true)}>
            Check my answer
          </Button>
          <Button variant="secondary">Show a hint</Button>
        </div>
        {/* Mounted from the start, so the feedback is announced when it appears. */}
        <LiveRegion>
          {checked ? (
            <Feedback kind="misconception">
              You added the numerators and the denominators. Fractions need a common denominator
              first.
            </Feedback>
          ) : null}
        </LiveRegion>
      </div>
    );
  },
};

/** The on-screen Foundation keyboard, as a touch-screen student sees it. */
export const FoundationKeyboard: Story = {
  render: function FoundationKeyboardStory() {
    useEffect(() => {
      const timer = window.setInterval(() => {
        const field = document.querySelector<HTMLElement>("math-field[data-ready='true']");
        if (!field) return;
        window.clearInterval(timer);
        field.focus();
        window.mathVirtualKeyboard.show();
      }, 100);
      return () => window.clearInterval(timer);
    }, []);
    return (
      <div className="max-w-md">
        <MathField label="Your answer" />
      </div>
    );
  },
};
