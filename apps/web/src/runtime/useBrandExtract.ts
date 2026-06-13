// `useBrandExtract` — drive the brand extraction SSE stream from React.
//
// POST /api/brands streams `event: <name>\ndata: <json>\n\n` frames whose
// shapes are the `BrandExtractEvent` union in `@open-design/contracts`. The
// daemon walks three phases — prefetch (fetch & measure) → preview (build a
// provisional brand) → system (derive & register a `user:` design system) —
// then emits a terminal `brand` event carrying the final brand id + kit.
//
// We reduce that stream into a 3-stage progress model the New Brand modal
// renders directly. The reader/decoder loop mirrors `fetchAgentsStream` in
// `providers/registry.ts` so SSE framing stays consistent across the app.

import { useCallback, useRef, useState } from 'react';
import type { Brand, BrandExtractEvent } from '@open-design/contracts';

/** Coarse extraction phase, derived from the SSE `phase` / terminal events. */
export type BrandExtractPhase =
  | 'idle'
  | 'prefetch'
  | 'preview'
  | 'system'
  | 'done'
  | 'error';

export interface BrandExtractMeasured {
  colors: number;
  fonts: number;
  logos: number;
}

export interface BrandExtractState {
  phase: BrandExtractPhase;
  /** Brand id, available from the `created` event onward. */
  brandId: string | null;
  /** Backing brand project id, available once the daemon has reserved it. */
  projectId: string | null;
  /** Latest prefetch step / detail line, for a live status under stage 1. */
  progress: string | null;
  /** Counts from `prefetch-done`, shown as "{colors} colors · …". */
  measured: BrandExtractMeasured | null;
  /** Provisional brand kit from the `preview` event (or the final `brand`). */
  preview: Brand | null;
  /** The `user:<id>` design-system id once the system phase succeeds. */
  designSystemId: string | null;
  /** Generated brand system files, relative to the backing brand system dir. */
  systemFiles: string[];
  /** Human-readable failure reason when `phase === 'error'`. */
  error: string | null;
}

const INITIAL_STATE: BrandExtractState = {
  phase: 'idle',
  brandId: null,
  projectId: null,
  progress: null,
  measured: null,
  preview: null,
  designSystemId: null,
  systemFiles: [],
  error: null,
};

export interface UseBrandExtract {
  state: BrandExtractState;
  run: (url: string) => Promise<void>;
  reset: () => void;
}

// Split one SSE record (`event: <name>\ndata: <json>`) into a typed event.
// Returns `null` for blank / heartbeat records and malformed JSON, so a
// single bad frame never aborts the whole stream.
function parseFrame(rawEvent: string): BrandExtractEvent | null {
  const dataLines: string[] = [];
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  const data = dataLines.join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data) as BrandExtractEvent;
  } catch {
    return null;
  }
}

export function useBrandExtract(): UseBrandExtract {
  const [state, setState] = useState<BrandExtractState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const apply = useCallback((event: BrandExtractEvent) => {
    setState((prev) => {
      switch (event.event) {
        case 'created':
          return {
            ...prev,
            brandId: event.id,
            projectId: event.projectId ?? prev.projectId,
            phase: prev.phase === 'idle' ? 'prefetch' : prev.phase,
          };
        case 'phase':
          // `done` here is a soft signal; the terminal `brand` event is what
          // actually carries the final kit. Map the rest straight through.
          return { ...prev, phase: event.phase };
        case 'prefetch':
          return {
            ...prev,
            phase: 'prefetch',
            progress: event.detail ? `${event.step} — ${event.detail}` : event.step,
          };
        case 'prefetch-done':
          return {
            ...prev,
            measured: { colors: event.colors, fonts: event.fonts, logos: event.logos },
          };
        case 'preview':
          return { ...prev, phase: 'preview', preview: event.brand };
        case 'system':
          return {
            ...prev,
            phase: event.ok ? 'system' : 'error',
            designSystemId: event.designSystemId ?? prev.designSystemId,
            projectId: event.projectId ?? prev.projectId,
            systemFiles: event.files ?? prev.systemFiles,
            error: event.ok ? prev.error : event.error ?? 'Failed to register design system',
          };
        case 'brand':
          return {
            ...prev,
            phase: 'done',
            brandId: event.id,
            projectId: event.projectId ?? prev.projectId,
            designSystemId: event.designSystemId ?? prev.designSystemId,
            systemFiles: event.files ?? prev.systemFiles,
            preview: event.brand,
          };
        case 'error':
          return { ...prev, phase: 'error', error: event.message };
        default:
          return prev;
      }
    });
  }, []);

  const run = useCallback(
    async (url: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...INITIAL_STATE, phase: 'prefetch' });

      let resp: Response;
      try {
        resp = await fetch('/api/brands', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: err instanceof Error ? err.message : 'Could not reach the daemon',
        }));
        return;
      }

      if (!resp.ok || !resp.body) {
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: `Extraction request failed (${resp.status})`,
        }));
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          // SSE records are separated by a blank line ("\n\n").
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (rawEvent.trim().length === 0) continue;
            const event = parseFrame(rawEvent);
            if (event) apply(event);
          }
        }
        // Flush any trailing record that arrived without a closing blank line.
        if (buffer.trim().length > 0) {
          const event = parseFrame(buffer);
          if (event) apply(event);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: err instanceof Error ? err.message : 'Extraction stream interrupted',
        }));
      } finally {
        try {
          await reader.cancel();
        } catch {
          // Reader may already be closed; nothing to do.
        }
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [apply],
  );

  return { state, run, reset };
}
