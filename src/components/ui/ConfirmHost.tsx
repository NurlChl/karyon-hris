"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, Modal } from "./index";

/**
 * In-app replacement for window.confirm: `if (await confirmDialog({...}))`.
 * One <ConfirmHost /> in the root layout renders the request with the same
 * Modal as every other dialog, so nothing falls back to the browser's popup.
 */
type Options = { title: string; message?: string; confirmLabel?: string; tone?: "danger" | "primary" };
type Request = { options: Options; resolve: (value: boolean) => void };

let push: ((request: Request) => void) | null = null;
const early: Request[] = [];

export function confirmDialog(options: Options): Promise<boolean> {
  return new Promise((resolve) => {
    const request = { options, resolve };
    if (push) push(request);
    else early.push(request);
  });
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const waiting = useRef<Request[]>([]);
  useEffect(() => {
    const show = (request: Request) => setCurrent((active) => {
      if (active) { waiting.current.push(request); return active; }
      return request;
    });
    push = show;
    early.splice(0).forEach(show);
    return () => { push = null; };
  }, []);
  const finish = (ok: boolean) => {
    current?.resolve(ok);
    setCurrent(waiting.current.shift() ?? null);
  };
  if (!current) return null;
  const { options } = current;
  return (
    <Modal
      open
      size="sm"
      title={options.title}
      onClose={() => finish(false)}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => finish(false)}>Batal</Button>
          <Button variant={options.tone ?? "danger"} size="sm" onClick={() => finish(true)} autoFocus>{options.confirmLabel ?? "Lanjutkan"}</Button>
        </>
      }
    >
      {options.message && <p className="text-body text-muted leading-relaxed">{options.message}</p>}
    </Modal>
  );
}
