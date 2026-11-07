import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./Chip";
import { ConfidencePicker, type Confidence } from "./ConfidencePicker";
import { Dialog } from "./Dialog";
import { PlayerControls } from "./Player";
import { Tabs } from "./Tabs";
import { ToastProvider, useToast } from "./Toast";
import { Toggle } from "./Toggle";

describe("Tabs", () => {
  const items = [
    { id: "a", label: "Ratio", content: <p>Ratio panel</p> },
    { id: "b", label: "Percentages", content: <p>Percentages panel</p> },
    { id: "c", label: "Averages", content: <p>Averages panel</p> },
  ];

  it("moves with arrow keys, Home and End, and shows the matching panel", async () => {
    const user = userEvent.setup();
    render(<Tabs label="Topics" items={items} />);
    const [ratio, percentages, averages] = screen.getAllByRole("tab");

    await user.click(ratio!);
    await user.keyboard("{ArrowRight}");
    expect(percentages).toHaveFocus();
    expect(percentages).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Percentages panel")).toBeVisible();

    await user.keyboard("{End}");
    expect(averages).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(ratio).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(averages).toHaveFocus();
  });

  it("falls back to the first tab when the default does not exist", () => {
    render(<Tabs label="Topics" items={items} defaultTabId="missing" />);
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("tabindex", "0");
  });

  it("keeps only the selected tab in the tab order", () => {
    render(<Tabs label="Topics" items={items} defaultTabId="b" />);
    const tabIndexes = screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"));
    expect(tabIndexes).toEqual(["-1", "0", "-1"]);
  });
});

describe("Toggle", () => {
  it("is a switch that flips on click and Space", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return <Toggle label="Reduce motion" checked={on} onChange={setOn} />;
    }
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Reduce motion" });
    expect(toggle).toHaveAccessibleName("Reduce motion");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

describe("ConfidencePicker", () => {
  it("is a labelled radio group with four levels", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<Confidence | null>(null);
      return <ConfidencePicker value={value} onChange={setValue} />;
    }
    render(<Harness />);
    expect(screen.getByRole("group", { name: "How sure are you?" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    await user.click(screen.getByLabelText("Fairly sure"));
    expect(screen.getByLabelText("Fairly sure")).toBeChecked();
  });
});

describe("Chip", () => {
  it("is a toggle button only when it can be pressed", () => {
    const { rerender } = render(<Chip>Static</Chip>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <Chip selected onClick={() => {}}>
        Ratio
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "Ratio" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Dialog", () => {
  it("is labelled by its title and closes from the Close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open title="Take a break?" description="Your progress is saved." onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Take a break?" });
    expect(dialog).toHaveAccessibleDescription("Your progress is saved.");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Toast", () => {
  it("announces messages in a polite live region and lets them be dismissed", async () => {
    const user = userEvent.setup();
    function Trigger() {
      const show = useToast();
      return (
        <button type="button" onClick={() => show({ title: "Saved", body: "See you Thursday." })}>
          Save
        </button>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Saved");
    await user.click(screen.getByRole("button", { name: "Dismiss: Saved" }));
    expect(region).not.toHaveTextContent("Saved");
  });

  function TimedTrigger() {
    const show = useToast();
    return (
      <button type="button" onClick={() => show({ title: "Review scheduled" })}>
        Go
      </button>
    );
  }

  it("removes messages after their time", () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider durationMs={1000}>
          <TimedTrigger />
        </ToastProvider>,
      );
      act(() => screen.getByRole("button", { name: "Go" }).click());
      expect(screen.getByRole("status")).toHaveTextContent("Review scheduled");
      act(() => vi.advanceTimersByTime(1001));
      expect(screen.getByRole("status")).not.toHaveTextContent("Review scheduled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a message while it has focus, then removes it", () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider durationMs={1000}>
          <TimedTrigger />
        </ToastProvider>,
      );
      act(() => screen.getByRole("button", { name: "Go" }).click());
      const dismiss = screen.getByRole("button", { name: "Dismiss: Review scheduled" });
      act(() => dismiss.focus());
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByRole("status")).toHaveTextContent("Review scheduled");
      act(() => dismiss.blur());
      act(() => vi.advanceTimersByTime(1001));
      expect(screen.getByRole("status")).not.toHaveTextContent("Review scheduled");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PlayerControls", () => {
  it("labels every control and reports pressed states", async () => {
    const user = userEvent.setup();
    const onSpeedChange = vi.fn();
    render(
      <PlayerControls
        playing={false}
        onPlayPause={() => {}}
        onReplay={() => {}}
        onStepBack={() => {}}
        onStepForward={() => {}}
        canStepBack={false}
        stepLabel="Step 1 of 6"
        speed={1}
        onSpeedChange={onSpeedChange}
        captions
        onCaptionsChange={() => {}}
        transcript={false}
        onTranscriptChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Playback speed" })).toBeInTheDocument();
    // Unavailable but still focusable, so a keyboard user stepping to the start keeps focus.
    const back = screen.getByRole("button", { name: "Previous step" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Captions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Transcript" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "1.25x" }));
    expect(onSpeedChange).toHaveBeenCalledWith(1.25);
    // No voice toggle unless the player asks for one.
    expect(screen.queryByRole("button", { name: "Voice" })).not.toBeInTheDocument();
  });

  it("offers the device voice, or says there is none", async () => {
    const user = userEvent.setup();
    const onVoiceChange = vi.fn();
    const controls = (available: boolean) => (
      <PlayerControls
        playing={false}
        onPlayPause={() => {}}
        onReplay={() => {}}
        onStepBack={() => {}}
        onStepForward={() => {}}
        speed={1}
        onSpeedChange={() => {}}
        captions
        onCaptionsChange={() => {}}
        transcript={false}
        onTranscriptChange={() => {}}
        voice
        onVoiceChange={onVoiceChange}
        voiceAvailable={available}
      />
    );
    const { rerender } = render(controls(true));
    const voice = screen.getByRole("button", { name: "Voice" });
    expect(voice).toHaveAttribute("aria-pressed", "true");
    await user.click(voice);
    expect(onVoiceChange).toHaveBeenCalledWith(false);
    rerender(controls(false));
    const none = screen.getByRole("button", { name: "No voice" });
    expect(none).toHaveAttribute("aria-disabled", "true");
    expect(none).toHaveAttribute("aria-pressed", "false");
    await user.click(none);
    expect(onVoiceChange).toHaveBeenCalledTimes(1);
  });
});
