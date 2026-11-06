"use client";

import { Component, type ReactNode } from "react";

/**
 * If a scene cannot be drawn, the student still gets its explanation as text, never a blank
 * space. The static checks catch these cases before serving; this is the last line.
 */
export interface SceneErrorBoundaryProps {
  narrations: readonly string[];
  children: ReactNode;
}

export class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        aria-label="Explanation"
        className="rounded-card border border-rule bg-paper-raised p-4"
      >
        <p className="m-0 mb-2 font-semibold">
          This picture could not be drawn, so here it is in words.
        </p>
        <ol className="m-0 flex flex-col gap-1 pl-6">
          {this.props.narrations.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      </section>
    );
  }
}
