// Rich "Add assets" zone for the design-system creation flow.
//
// Replaces the generic text-only DropZone for the assets row with a real,
// tactile surface:
//   - drag & drop  (directory-aware; the parent reads the DataTransfer)
//   - click to browse
//   - paste (Cmd/Ctrl+V image/file content from the clipboard)
//   - "Select from library" — pull existing OD Library assets in
//   - a thumbnail grid with remove + click-to-enlarge preview
//
// The component is presentational over `files: File[]` (the parent's
// `assetFileObjects`); all staging/dedup/limits live in the parent so the
// generic upload path and this one stay in lockstep.

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import styles from './DesignSystemAssetDropzone.module.css';

interface Props {
  /** Currently staged asset File objects (the parent's `assetFileObjects`). */
  files: File[];
  /** Flat files chosen via click or paste; the parent filters + stages them. */
  onAddFiles: (files: File[]) => void;
  /** A native drop — the parent reads it (directory-aware) then stages. */
  onDrop: (dataTransfer: DataTransfer) => void;
  /** Remove one staged file (matched by reference). */
  onRemove: (file: File) => void;
  /** Open the "Select from library" picker. */
  onSelectFromLibrary: () => void;
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Object URL for an image preview, or null where unavailable (e.g. jsdom). */
function createPreviewUrl(file: File): string | null {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revokePreviewUrl(url: string): void {
  try {
    URL.revokeObjectURL?.(url);
  } catch {
    /* no-op */
  }
}

function fileExt(file: File): string {
  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  return (match?.[1] ?? 'file').toUpperCase().slice(0, 4);
}

function formatBytes(n: number): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A stable key for a staged File (name + size + mtime is collision-safe here). */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isEditableTarget(node: EventTarget | null): boolean {
  const el = node as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

export function DesignSystemAssetDropzone({
  files,
  onAddFiles,
  onDrop,
  onRemove,
  onSelectFromLibrary,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<File | null>(null);

  // Object URLs for image previews. Creation and revocation MUST be paired
  // inside one `files`-keyed effect: the cleanup revokes exactly the URLs its
  // own setup created. This is the StrictMode-safe shape. The previous split —
  // create in a useMemo, revoke in a separate empty-deps cleanup — broke any
  // preview staged at first mount: StrictMode's simulated unmount fired the
  // cleanup and revoked the URLs, then the remount left the memo (deps
  // unchanged) handing back those now-dead blob: links. That is exactly the
  // Library "create design system" hand-off, where assets are present before
  // the user touches the dropzone, so its thumbnails rendered as broken images.
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    const next = new Map<File, string>();
    for (const file of files) {
      if (!isImage(file)) continue;
      const url = createPreviewUrl(file);
      if (url) next.set(file, url);
    }
    setPreviews(next);
    return () => {
      for (const url of next.values()) revokePreviewUrl(url);
    };
  }, [files]);

  // Paste anywhere on the page routes image/file clipboard content into the
  // asset zone — unless focus is in a text field (brand description / notes),
  // where a normal text paste must win.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length === 0) return;
      event.preventDefault();
      onAddFiles(pasted);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onAddFiles]);

  // Close the lightbox on Escape.
  useEffect(() => {
    if (!lightbox) return undefined;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setLightbox(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  function openPicker() {
    inputRef.current?.click();
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (picked.length > 0) onAddFiles(picked);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    onDrop(event.dataTransfer);
  }

  function handleZoneKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  }

  const lightboxUrl = lightbox ? previews.get(lightbox) : undefined;

  return (
    <div className={styles.root}>
      <div
        className={`${styles.drop}${dragOver ? ` ${styles.dropActive}` : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Add assets — drag and drop, paste, or click to browse"
        data-testid="ds-asset-dropzone"
        onClick={openPicker}
        onKeyDown={handleZoneKey}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className={styles.input}
          onChange={handleInput}
        />
        <span className={styles.dropIcon}>
          <Icon name="upload" size={19} />
        </span>
        <span className={styles.dropTitle}>
          Drag &amp; drop, paste, or <span className={styles.dropLink}>browse</span>
        </span>
        <span className={styles.dropHint}>Images, fonts and logos — up to 12 MB each</span>
      </div>

      <div className={styles.alt}>
        <span className={styles.altText}>or reuse an asset you’ve already saved</span>
        <button
          type="button"
          className={styles.libraryBtn}
          data-testid="ds-asset-library"
          onClick={onSelectFromLibrary}
        >
          <Icon name="layers-filled" size={14} />
          Select from library
        </button>
      </div>

      {files.length > 0 ? (
        <ul className={styles.grid} aria-label="Staged assets">
          {files.map((file) => {
            const url = previews.get(file);
            return (
              <li key={fileKey(file)} className={styles.tile}>
                <button
                  type="button"
                  className={styles.tileMain}
                  onClick={() => {
                    if (url) setLightbox(file);
                  }}
                  disabled={!url}
                  title={file.name}
                >
                  {url ? (
                    <img src={url} alt="" className={styles.thumb} loading="lazy" />
                  ) : (
                    <span className={styles.glyph}>
                      <span className={styles.ext}>{fileExt(file)}</span>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onRemove(file)}
                >
                  <Icon name="close" size={12} />
                </button>
                <span className={styles.caption} title={file.name}>
                  {file.name}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {lightbox && lightboxUrl
        ? createPortal(
            <div className={styles.lightbox} onClick={() => setLightbox(null)} role="presentation">
              <div
                className={styles.lightboxInner}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={lightbox.name}
              >
                <img src={lightboxUrl} alt={lightbox.name} className={styles.lightboxImg} />
                <div className={styles.lightboxBar}>
                  <span className={styles.lightboxName} title={lightbox.name}>
                    {lightbox.name}
                  </span>
                  <span className={styles.lightboxMeta}>{formatBytes(lightbox.size)}</span>
                  <button
                    type="button"
                    className={styles.lightboxClose}
                    onClick={() => setLightbox(null)}
                    aria-label="Close preview"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
