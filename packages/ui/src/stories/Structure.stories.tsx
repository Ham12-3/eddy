import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Dialog } from "../components/Dialog";
import { CheckboxField, SelectField, TextField } from "../components/Fields";
import { ProgressMapNode } from "../components/ProgressMapNode";
import { EmptyState, ErrorState, SkeletonText } from "../components/States";
import { Tabs } from "../components/Tabs";
import { ToastProvider, useToast } from "../components/Toast";
import { Toggle } from "../components/Toggle";

const meta = { title: "Design system/Structure" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Cards: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Card as="section">
        <h3 className="m-0 text-h4">Today&apos;s plan</h3>
        <p className="mb-0 text-ink-muted">One new topic, two reviews. About 20 minutes.</p>
      </Card>
      <Card as="section" aria-busy="true">
        <h3 className="m-0 mb-3 text-h4">Loading your reviews</h3>
        <SkeletonText lines={3} />
      </Card>
    </div>
  ),
};

export const Forms: Story = {
  render: function FormsStory() {
    const [reduceMotion, setReduceMotion] = useState(false);
    const [dyslexia, setDyslexia] = useState(true);
    return (
      <form className="flex max-w-md flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
        <TextField
          label="First name"
          hint="Only you and Eddy see this."
          autoComplete="given-name"
        />
        <TextField
          label="Exam series"
          defaultValue="June 2027"
          error="Choose a series from the list."
        />
        <SelectField
          label="Exam board"
          defaultValue="aqa"
          options={[
            { value: "aqa", label: "AQA" },
            { value: "edexcel", label: "Edexcel" },
            { value: "ocr", label: "OCR" },
          ]}
        />
        <CheckboxField label="Captions only" hint="Turn narration off and read along instead." />
        <Toggle
          label="Reduce motion"
          description="Fade between steps instead of moving."
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        <Toggle label="Dyslexia-friendly text" checked={dyslexia} onChange={setDyslexia} />
        <div>
          <Button type="submit">Save settings</Button>
        </div>
      </form>
    );
  },
};

export const TopicTabs: Story = {
  render: () => (
    <div className="max-w-2xl">
      <Tabs
        label="Topics"
        items={[
          {
            id: "ratio",
            label: "Ratio",
            content: <p className="m-0">Share amounts in a given ratio.</p>,
          },
          {
            id: "percent",
            label: "Percentages",
            content: <p className="m-0">Increase, decrease and reverse.</p>,
          },
          {
            id: "averages",
            label: "Averages",
            content: <p className="m-0">Mean, median, mode and range.</p>,
          },
        ]}
      />
    </div>
  ),
};

export const ProgressMap: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      <ProgressMapNode title="Negative numbers" state="secure" />
      <ProgressMapNode title="Ratio" state="learning" />
      <ProgressMapNode title="Percentages" state="needs-review" />
      <ProgressMapNode title="Pythagoras" state="not-started" />
    </div>
  ),
};

export const EmptyAndError: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <EmptyState
        title="No reviews due"
        action={<Button variant="secondary">Practise something new</Button>}
      >
        Your next review is on Thursday. Nothing to catch up on today.
      </EmptyState>
      <ErrorState title="We could not load your plan" action={<Button>Try again</Button>}>
        This is our problem, not yours. Your progress is safe.
      </ErrorState>
    </div>
  ),
};

export const DialogAndSheet: Story = {
  render: function DialogStory() {
    const [open, setOpen] = useState<"dialog" | "sheet" | null>(null);
    return (
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => setOpen("dialog")}>
          Open dialog
        </Button>
        <Button variant="secondary" onClick={() => setOpen("sheet")}>
          Open sheet
        </Button>
        <Dialog
          open={open === "dialog"}
          onClose={() => setOpen(null)}
          title="Good place to stop"
          description="You have practised for 25 minutes."
          actions={
            <>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Keep going
              </Button>
              <Button onClick={() => setOpen(null)}>Finish for today</Button>
            </>
          }
        >
          <p className="m-0">Your next review is due on Thursday.</p>
        </Dialog>
        <Dialog
          variant="sheet"
          open={open === "sheet"}
          onClose={() => setOpen(null)}
          title="Settings"
        >
          <Toggle label="Captions" checked onChange={() => {}} />
        </Dialog>
      </div>
    );
  },
};

/** Opens straight away, so screenshots and axe see the open state. */
export const DialogOpen: Story = {
  render: () => (
    <Dialog
      open
      onClose={() => {}}
      title="Good place to stop"
      description="You have practised for 25 minutes."
      actions={<Button>Finish for today</Button>}
    >
      <p className="m-0">Your next review is due on Thursday.</p>
    </Dialog>
  ),
};

export const Toasts: Story = {
  render: function ToastStory() {
    function Trigger() {
      const show = useToast();
      return (
        <Button
          variant="secondary"
          onClick={() => show({ title: "Saved", body: "Your next review is on Thursday." })}
        >
          Save
        </Button>
      );
    }
    return (
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
  },
};

/** The sheet in its open state, for screenshots and axe. */
export const SheetOpen: Story = {
  render: () => (
    <Dialog
      variant="sheet"
      open
      onClose={() => {}}
      title="Settings"
      description="Changes save as you go."
    >
      <Toggle
        label="Captions"
        description="Show the words as they are spoken."
        checked
        onChange={() => {}}
      />
      <Toggle label="Reduce motion" checked={false} onChange={() => {}} />
    </Dialog>
  ),
};

/** A toast already showing, for screenshots and axe. */
export const ToastShowing: Story = {
  render: function ToastShowingStory() {
    function ShowOnce() {
      const show = useToast();
      useEffect(() => {
        show({ title: "Saved", body: "Your next review is on Thursday." });
      }, [show]);
      return null;
    }
    return (
      <ToastProvider durationMs={600_000}>
        <ShowOnce />
      </ToastProvider>
    );
  },
};
