"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./icons";

export interface ToastMessage {
  title: string;
  body?: string;
}

type ShowToast = (message: ToastMessage) => void;

const ToastContext = createContext<ShowToast | null>(null);

/**
 * Quiet, short-lived notes ("Saved", "Review scheduled"). No confetti, never the only place
 * important information appears. Announced politely to screen readers.
 */
export function ToastProvider({
  children,
  durationMs = 6000,
}: {
  children: ReactNode;
  durationMs?: number;
}) {
  const [messages, setMessages] = useState<Array<ToastMessage & { id: number }>>([]);
  const nextId = useRef(1);
  // While the pointer or focus is on a toast, nothing disappears from under it (WCAG 2.2.1).
  const paused = useRef(false);

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message) => {
      const id = nextId.current++;
      setMessages((current) => [...current.slice(-2), { ...message, id }]);
      const expire = () => {
        if (paused.current) window.setTimeout(expire, 1000);
        else dismiss(id);
      };
      window.setTimeout(expire, durationMs);
    },
    [dismiss, durationMs],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => {
          paused.current = true;
        }}
        onMouseLeave={() => {
          paused.current = false;
        }}
        onFocus={() => {
          paused.current = true;
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) paused.current = false;
        }}
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:right-6 sm:bottom-6 sm:left-auto"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-rule bg-paper-raised p-4 shadow-raised"
          >
            <div className="flex-1">
              <p className="m-0 font-semibold">{message.title}</p>
              {message.body ? <p className="m-0 mt-1 text-ink-muted">{message.body}</p> : null}
            </div>
            <button
              type="button"
              aria-label={`Dismiss: ${message.title}`}
              onClick={() => dismiss(message.id)}
              className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control hover:bg-paper"
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>.");
  return show;
}
