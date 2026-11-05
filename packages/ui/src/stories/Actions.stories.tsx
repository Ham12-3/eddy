import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Link } from "../components/Link";

const meta = { title: "Design system/Actions" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="accent">Check my answer</Button>
        <Button>Next question</Button>
        <Button variant="secondary">Show a hint</Button>
        <Button variant="quiet">Skip for now</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button busy>Saving</Button>
        <Button variant="secondary" disabled>
          Not available yet
        </Button>
      </div>
    </div>
  ),
};

export const Links: Story = {
  render: () => (
    <p className="max-w-prose">
      Read the <Link href="#privacy">privacy notice</Link>, or talk to{" "}
      <Link href="https://www.childline.org.uk" external>
        Childline
      </Link>{" "}
      on 0800 1111.
    </p>
  ),
};

export const Chips: Story = {
  render: function ChipsStory() {
    const [selected, setSelected] = useState(["ratio"]);
    const toggle = (id: string) =>
      setSelected((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      );
    return (
      <div className="flex flex-wrap gap-2">
        <Chip>Foundation</Chip>
        <Chip>AQA</Chip>
        {["ratio", "percentages", "averages"].map((id) => (
          <Chip key={id} selected={selected.includes(id)} onClick={() => toggle(id)}>
            {id[0]!.toUpperCase() + id.slice(1)}
          </Chip>
        ))}
      </div>
    );
  },
};
