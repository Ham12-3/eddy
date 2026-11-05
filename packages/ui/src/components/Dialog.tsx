"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { CloseIcon } from "./icons";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** A sheet rises from the bottom on phones and slides in from the side on wider screens. */
  variant?: "dialog" | "sheet";
}

/** A modal on the native <dialog>: focus is trapped, Escape closes, focus returns afterwards. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  variant = "dialog",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      className={cx(
        "border border-rule bg-paper-raised p-0 text-ink shadow-raised backdrop:bg-paper/80",
        variant === "sheet"
          ? "mx-0 mt-auto mb-0 w-full max-w-none rounded-t-sheet sm:mt-0 sm:mr-0 sm:ml-auto sm:h-full sm:max-h-none sm:w-[28rem] sm:rounded-none sm:rounded-l-sheet"
          : "m-auto w-[min(34rem,calc(100%-2rem))] rounded-sheet",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
        <div>
          <h2 id={titleId} className="m-0 text-h4">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="m-0 mt-1 text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control hover:bg-paper"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="px-6 py-4">{children}</div>
      {actions ? (
        <div className="flex flex-wrap justify-end gap-3 border-t border-rule px-6 py-4">
          {actions}
        </div>
      ) : null}
    </dialog>
  );
}
