import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import { useBrandExtract } from '../runtime/useBrandExtract';
import type { BrandExtractPhase } from '../runtime/useBrandExtract';
import styles from './NewBrandModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (brandId: string, projectId?: string) => void;
}

// The three visible stages map onto the daemon's extraction phases:
//   1. prefetch  → fetch the site & measure its design
//   2. preview   → build a brand preview
//   3. system    → derive & register the design system
// `done` lights all three; `error` freezes the active one.
type StageKey = 'prefetch' | 'preview' | 'system';
type StageStatus = 'pending' | 'running' | 'done' | 'error';

const STAGE_ORDER: StageKey[] = ['prefetch', 'preview', 'system'];

// Rank phases so we can decide whether a given stage is past / current / future.
const PHASE_RANK: Record<BrandExtractPhase, number> = {
  idle: 0,
  prefetch: 1,
  preview: 2,
  system: 3,
  done: 4,
  error: -1,
};

function stageStatus(
  stage: StageKey,
  phase: BrandExtractPhase,
  errorStage: StageKey | null,
): StageStatus {
  if (phase === 'error') {
    if (errorStage === stage) return 'error';
    // Stages that completed before the failure still read as done.
    return STAGE_ORDER.indexOf(stage) < (errorStage ? STAGE_ORDER.indexOf(errorStage) : 0)
      ? 'done'
      : 'pending';
  }
  if (phase === 'done') return 'done';
  const stageRank = STAGE_ORDER.indexOf(stage) + 1; // prefetch=1, preview=2, system=3
  const phaseRank = PHASE_RANK[phase];
  if (phaseRank > stageRank) return 'done';
  if (phaseRank === stageRank) return 'running';
  return 'pending';
}

export function NewBrandModal({ open, onClose, onCreated }: Props) {
  const t = useT();
  const { state, run, reset } = useBrandExtract();
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Latch the stage that was active when an error landed, so the failed
  // stage renders red and the earlier ones stay green.
  const errorStageRef = useRef<StageKey | null>(null);

  const running =
    state.phase === 'prefetch' || state.phase === 'preview' || state.phase === 'system';
  const finished = state.phase === 'done';
  const failed = state.phase === 'error';

  if (failed && errorStageRef.current === null) {
    errorStageRef.current =
      state.designSystemId !== null || state.preview !== null
        ? 'system'
        : state.measured !== null
          ? 'preview'
          : 'prefetch';
  }
  if (!failed) errorStageRef.current = null;

  // Reset the form each time the modal opens fresh; focus the URL field.
  useEffect(() => {
    if (open) {
      setUrl('');
      reset();
      const id = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open, reset]);

  // When the terminal `brand` event lands, hand the new id up and close.
  // The parent refetches + navigates; we close on the next tick so the
  // success state is visible for a beat.
  useEffect(() => {
    if (state.phase === 'done' && state.brandId) {
      const id = state.brandId;
      const projectId = state.projectId ?? undefined;
      const timer = window.setTimeout(() => {
        onCreated(id, projectId);
      }, 650);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [state.phase, state.brandId, state.projectId, onCreated]);

  const handleClose = useCallback(() => {
    if (running) return; // don't allow dismissing mid-extraction by backdrop/esc
    reset();
    onClose();
  }, [running, reset, onClose]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed || running) return;
      void run(trimmed);
    },
    [url, running, run],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  const measuredLine = useMemo(() => {
    if (!state.measured) return null;
    return t('newBrand.measured', {
      colors: state.measured.colors,
      fonts: state.measured.fonts,
      logos: state.measured.logos,
    });
  }, [state.measured, t]);

  if (!open) return null;

  const stageLabels: Record<StageKey, string> = {
    prefetch: t('newBrand.stage1'),
    preview: t('newBrand.stage2'),
    system: t('newBrand.stage3'),
  };

  const showProgress = running || finished || failed;
  const closeLabel = finished || failed ? t('newBrand.close') : t('newBrand.cancel');

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={t('newBrand.title')}
        data-testid="new-brand-modal"
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{t('newBrand.title')}</h2>
          <p className={styles.subtitle}>{t('newBrand.subtitle')}</p>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>{t('newBrand.urlLabel')}</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="url"
              autoComplete="url"
              className={styles.input}
              placeholder={t('newBrand.urlPlaceholder')}
              value={url}
              disabled={running}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="new-brand-url"
            />
          </label>

          {showProgress ? (
            <ol className={styles.stages} data-testid="new-brand-stages">
              {STAGE_ORDER.map((stage) => {
                const status = stageStatus(stage, state.phase, errorStageRef.current);
                return (
                  <li key={stage} className={styles.stage} data-status={status}>
                    <span className={styles.stageIcon} aria-hidden>
                      {status === 'done' ? (
                        <CheckGlyph />
                      ) : status === 'error' ? (
                        <CrossGlyph />
                      ) : status === 'running' ? (
                        <span className={styles.spinner} />
                      ) : (
                        <span className={styles.dot} />
                      )}
                    </span>
                    <span className={styles.stageBody}>
                      <span className={styles.stageLabel}>{stageLabels[stage]}</span>
                      {stage === 'prefetch' && status === 'running' && state.progress ? (
                        <span className={styles.stageDetail}>{state.progress}</span>
                      ) : null}
                      {stage === 'prefetch' && measuredLine ? (
                        <span className={styles.stageDetail}>{measuredLine}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {finished ? (
            <p className={styles.doneLine} role="status">
              {t('newBrand.done')}
            </p>
          ) : null}
          {failed ? (
            <p className={styles.errorLine} role="alert">
              {state.error ?? t('brand.failed')}
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={handleClose} disabled={running}>
              {closeLabel}
            </Button>
            {!finished ? (
              <Button
                type="submit"
                variant="primary"
                disabled={running || url.trim().length === 0}
                data-testid="new-brand-extract"
              >
                {running ? t('brand.extracting') : t('newBrand.extract')}
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
