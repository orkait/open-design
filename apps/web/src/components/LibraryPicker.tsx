// Reusable "Select from library" modal.
//
// Surfaces the OD Library (资源库) as a multi-select grid so a user can pull
// existing assets into the chat composer (as context attachments) or into a
// project's Design Files. The caller owns what "confirm" means via `onConfirm`
// — both entry points materialize the picks through the same
// `applyLibraryAsset` registry helper (POST /api/library/assets/:id/apply),
// which copies the bytes into the project AND records a provenance back-link so
// the registry knows the asset was consumed.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { LibraryAsset } from '@open-design/contracts';
import { Button, Input } from '@open-design/components';
import { useT } from '../i18n';
import { modalOverlay, modalContent } from '../motion';
import { fetchLibraryAssets, libraryAssetRawUrl } from '../providers/registry';
import {
  KindIcon,
  assetTitle,
  badgeKind,
  colorOf,
  kindLabel,
  kindTint,
  matchesKindFilter,
} from './LibraryAssetMeta';
import type { BadgeKind } from './LibraryAssetMeta';
import { Icon } from './Icon';
import styles from './LibraryPicker.module.css';

// Mirrors the Library grid's chips. `element` is a badge-only identity (an image
// clip carrying `metadata.element`), so it has no storage kind of its own; the
// filter keys off `badgeKind` via `matchesKindFilter`.
const KIND_FILTERS: BadgeKind[] = [
  'image',
  'element',
  'video',
  'html',
  'font',
  'color',
  'text',
  'url',
];

interface Props {
  onClose: () => void;
  /**
   * Invoked with the chosen assets when the user confirms. May be async — the
   * picker keeps a busy state until it resolves, then closes itself.
   */
  onConfirm: (assets: LibraryAsset[]) => void | Promise<void>;
  /** Heading override; defaults to the shared "Select from library" copy. */
  title?: string;
  /** Confirm-button label override; defaults to "Add". */
  confirmLabel?: string;
}

export function LibraryPicker({ onClose, onConfirm, title, confirmLabel }: Props) {
  const t = useT();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<BadgeKind | ''>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchLibraryAssets().then((next) => {
      if (cancelled) return;
      setAssets(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (!matchesKindFilter(asset, kind)) return false;
      if (!q) return true;
      const hay = `${assetTitle(asset)} ${asset.tags?.join(' ') ?? ''} ${asset.caption ?? ''} ${
        asset.sourceDomain ?? ''
      } ${asset.ocrText ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assets, kind, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    const picked = assets.filter((asset) => selected.has(asset.id));
    if (picked.length === 0 || busy) return;
    setBusy(true);
    try {
      await onConfirm(picked);
    } finally {
      onClose();
    }
  }

  const count = selected.size;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
      variants={modalOverlay}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        variants={modalContent}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        data-testid="library-picker"
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <Icon name="layers-filled" size={16} />
            <h2>{title ?? t('libraryPicker.title')}</h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={busy}
            aria-label={t('common.cancel')}
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className={styles.toolbar}>
          <Input
            type="search"
            value={search}
            placeholder={t('libraryPicker.searchPlaceholder')}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="library-picker-search"
          />
          <div className={styles.kinds} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={kind === ''}
              className={`${styles.chip}${kind === '' ? ` ${styles.chipActive}` : ''}`}
              onClick={() => setKind('')}
            >
              {t('libraryPicker.allKinds')}
            </button>
            {KIND_FILTERS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={`${styles.chip}${kind === k ? ` ${styles.chipActive}` : ''}`}
                onClick={() => setKind((prev) => (prev === k ? '' : k))}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.placeholder}>{t('libraryPicker.loading')}</div>
          ) : visible.length === 0 ? (
            <div className={styles.placeholder}>{t('libraryPicker.empty')}</div>
          ) : (
            <ul className={styles.grid}>
              {visible.map((asset) => {
                const isSelected = selected.has(asset.id);
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      className={`${styles.card}${isSelected ? ` ${styles.cardSelected}` : ''}`}
                      onClick={() => toggle(asset.id)}
                      aria-pressed={isSelected}
                      title={assetTitle(asset)}
                    >
                      <span className={styles.thumb}>
                        <AssetThumb asset={asset} />
                        <span
                          className={styles.kindBadge}
                          style={{ ['--kind-tint' as string]: kindTint(badgeKind(asset)) }}
                        >
                          <KindIcon kind={badgeKind(asset)} size={11} />
                          {kindLabel(badgeKind(asset))}
                        </span>
                        {isSelected ? (
                          <span className={styles.check} aria-hidden>
                            <Icon name="check" size={12} />
                          </span>
                        ) : null}
                      </span>
                      <span className={styles.label}>{assetTitle(asset)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className={styles.footer}>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={confirm}
            disabled={count === 0 || busy}
            data-testid="library-picker-confirm"
          >
            {busy ? t('libraryPicker.loading') : confirmLabel ?? t('libraryPicker.add')}
            {count > 0 && !busy ? ` (${count})` : ''}
          </Button>
        </footer>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function AssetThumb({ asset }: { asset: LibraryAsset }) {
  if (asset.kind === 'image') {
    return (
      <img src={libraryAssetRawUrl(asset.id)} alt="" loading="lazy" className={styles.thumbImg} />
    );
  }
  if (asset.kind === 'video') {
    return (
      <video
        src={libraryAssetRawUrl(asset.id)}
        muted
        playsInline
        preload="metadata"
        className={styles.thumbImg}
      />
    );
  }
  if (asset.kind === 'color') {
    const color = colorOf(asset);
    if (color) {
      return <span className={styles.swatch} style={{ background: color }} aria-hidden />;
    }
  }
  return (
    <span className={styles.glyph} aria-hidden>
      <KindIcon kind={asset.kind} size={26} />
    </span>
  );
}
