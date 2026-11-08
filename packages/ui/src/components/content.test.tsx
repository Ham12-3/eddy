import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Feedback, LiveRegion } from "./Feedback";
import { CheckboxField, TextField } from "./Fields";
import { Link } from "./Link";
import { Maths } from "./Maths";
import { CaptionsPanel } from "./Player";
import { ProgressMapNode } from "./ProgressMapNode";
import { QuestionCard } from "./QuestionCard";
import { EmptyState, ErrorState } from "./States";
import { WorkingPad } from "./WorkingPad";

describe("Button", () => {
  it("defaults to type=button, and ignores presses while busy without losing focus", () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toBeDisabled(); // a disabled button would drop keyboard focus
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    button.focus();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });
});

describe("Link", () => {
  it("tells screen reader users when it opens a new tab", () => {
    render(
      <Link href="https://www.childline.org.uk" external>
        Childline
      </Link>,
    );
    const link = screen.getByRole("link", { name: "Childline (opens in a new tab)" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("Feedback", () => {
  it("names the kind in words, not just colour", () => {
    render(<Feedback kind="misconception">You added the denominators.</Feedback>);
    expect(screen.getByText("A common slip")).toBeInTheDocument();
  });

  it("is announced when it appears inside a mounted LiveRegion", () => {
    const { rerender } = render(<LiveRegion />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    rerender(
      <LiveRegion>
        <Feedback kind="correct">Well reasoned.</Feedback>
      </LiveRegion>,
    );
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Well reasoned.");
  });
});

describe("Maths", () => {
  it("renders MathML for screen readers and refuses link commands", () => {
    const { container } = render(<Maths latex={"\\frac{1}{2} + \\href{https://x.test}{y}"} />);
    expect(container.querySelector("math")).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("colours by role", () => {
    const { container } = render(<Maths latex="2x" tone="student" />);
    expect(container.firstElementChild).toHaveClass("text-student");
  });
});

describe("QuestionCard", () => {
  it("is a labelled question with marks written out", () => {
    render(
      <QuestionCard number={3} commandWord="Work out" marks={2} calculator={false}>
        <p>Share 45 in the ratio 2 : 3.</p>
      </QuestionCard>,
    );
    const card = screen.getByRole("article", { name: "Question 3" });
    expect(card).toHaveTextContent("[2 marks]");
    expect(card).toHaveTextContent("No calculator");
  });
});

describe("WorkingPad", () => {
  it("shows an empty prompt, then the student's lines in order", () => {
    const { rerender } = render(<WorkingPad lines={[]} />);
    expect(screen.getByText("Your working will appear here.")).toBeInTheDocument();
    rerender(<WorkingPad lines={["45 / 5 = 9", "2 x 9 = 18"]} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "45 / 5 = 9",
      "2 x 9 = 18",
    ]);
  });
});

describe("ProgressMapNode", () => {
  it("writes the mastery state out", () => {
    render(<ProgressMapNode title="Ratio" state="needs-review" />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
  });
});

describe("Fields", () => {
  it("wires hint and error to the input", () => {
    render(
      <TextField
        label="First name"
        hint="Only your teacher sees this."
        error="Please add a name."
      />,
    );
    const input = screen.getByLabelText("First name");
    expect(input).toHaveAccessibleDescription("Only your teacher sees this. Please add a name.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("labels checkboxes", () => {
    render(<CheckboxField label="Captions only" hint="No narration." />);
    expect(screen.getByRole("checkbox", { name: "Captions only" })).toHaveAccessibleDescription(
      "No narration.",
    );
  });
});

describe("States", () => {
  it("give empty and error states a heading at the requested level", () => {
    render(
      <>
        <EmptyState title="No reviews due" headingLevel={2} />
        <ErrorState title="We could not load your plan" />
      </>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "No reviews due" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "We could not load your plan" }),
    ).toBeInTheDocument();
  });
});

describe("CaptionsPanel", () => {
  it("marks the current transcript line", () => {
    render(
      <CaptionsPanel
        current="Two parts"
        transcript={["One", "Two parts"]}
        activeIndex={1}
        showTranscript
      />,
    );
    expect(screen.getByText("Two parts", { selector: "li" })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});
