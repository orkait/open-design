// OD Library tab — the global asset registry grid.
//
// Shows every asset that has entered the system (clipper capture, manual
// upload, agent task, design-system staging, AI generation) with a source
// badge, a kind badge, and back-links. Captures from the browser extension
// stream in live over the `/api/library/events` SSE feed. The OD Clipper is
// zero-config — it connects automatically whenever Open Design is running
// locally, so there is no pairing step here.
//
// Each card thumbnail is kind-aware (image / video / html / font / color) and
// opens a full-size, kind-aware preview (LibraryPreviewModal) on click. Cards
// are also multi-selectable — checkbox, Cmd/Ctrl+click, Shift+click range, a
// rubber-band box drag, Cmd/Ctrl+A — and the selection can be bulk-deleted from
// the action bar or with Delete / Backspace.
//
// Copy is intentionally inline (not yet i18n-keyed) — localization of the
// Library surface is a tracked follow-up.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, DesignSystemSummary, LibraryAsset } from '@open-design/contracts';
import {
  applyLibraryAsset,
  deleteLibraryAsset,
  editLibraryAssetAsPage,
  fetchDesignSystem,
  fetchDesignSystems,
  fetchLibraryAssets,
  fetchLibraryAssetAsFile,
  libraryAssetRawUrl,
  type LibraryAssetQuery,
} from '../providers/registry';
import { navigate } from '../router';
import { setComposerSeed, setDesignSystemAssetSeed, setHomeComposerAssetSeed } from '../state/libraryHandoff';
import { Button, Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { Icon } from './Icon';
import {
  KindIcon,
  SOURCE_LABELS,
  assetTitle,
  badgeKind,
  fontFamilyFor,
  kindLabel,
  kindTint,
  matchesKindFilter,
  originProjectId,
  primarySource,
  type KindFilterValue,
} from './LibraryAssetMeta';
import { LibraryPreviewModal } from './LibraryPreviewModal';
import { LibraryUploadModal } from './LibraryUploadModal';
import styles from './LibrarySection.module.css';

interface Props {
  active: boolean;
  /** Open a project, optionally deep-linking to a specific file in the editor. */
  onOpenProject: (projectId: string, fileName?: string) => void;
}

// `value` is matched against an asset's `badgeKind` (not its raw storage kind),
// so `element` isolates clipper element-pick captures and `image` excludes them.
const KIND_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All kinds' },
  { value: 'image', label: 'Images' },
  { value: 'element', label: 'Elements' },
  { value: 'video', label: 'Video' },
  { value: 'html', label: 'HTML' },
  { value: 'font', label: 'Fonts' },
  { value: 'color', label: 'Colors' },
  { value: 'text', label: 'Text' },
  { value: 'url', label: 'Links' },
];

const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'clipper', label: 'Clipper' },
  { value: 'manual-upload', label: 'Upload' },
  { value: 'agent-task', label: 'Agent' },
  { value: 'design-system', label: 'Design system' },
  { value: 'generated', label: 'Generated' },
];

/** Local `YYYY-MM-DD` for a Date — matches the daemon's `archivedDate` bucket. */
function ymdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day bucket an asset belongs to (prefers the daemon's archive date). */
function dayKeyOf(asset: LibraryAsset): string {
  return asset.archivedDate || ymdLocal(new Date(asset.capturedAt));
}

/** Human heading for a `YYYY-MM-DD` day bucket — Today / Yesterday / a date. */
function dayHeading(key: string): string {
  const today = ymdLocal(new Date());
  const yesterday = ymdLocal(new Date(Date.now() - 86_400_000));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Kind-aware thumbnail. Stays fetch-free so the grid scrolls cheaply. */
function Thumb({ asset }: { asset: LibraryAsset }) {
  const rawUrl = libraryAssetRawUrl(asset.id);
  const title = assetTitle(asset);
  switch (asset.kind) {
    case 'image':
      return <img className={styles.thumbImg} src={rawUrl} alt={title} loading="lazy" />;
    case 'video':
      return (
        <>
          <video className={styles.thumbImg} src={rawUrl} muted preload="metadata" playsInline />
          <span className={styles.playGlyph} aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </>
      );
    case 'html':
      // Static (no scripts) sandboxed render — a faithful, lightweight preview
      // of the captured page. The modal re-renders it with scripts for motion.
      return (
        <iframe
          className={styles.thumbFrame}
          src={rawUrl}
          sandbox=""
          scrolling="no"
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          title={title}
        />
      );
    case 'font':
      return (
        <div className={styles.thumbFont} style={{ fontFamily: `"${fontFamilyFor(asset.id)}", sans-serif` }}>
          Ag
        </div>
      );
    case 'color': {
      const swatch = asset.palette?.find((c) => typeof c === 'string' && c.trim());
      return swatch ? (
        <div className={styles.thumbColor} style={{ background: swatch }} />
      ) : (
        <div className={styles.thumbGlyph}>
          <KindIcon kind="color" size={34} />
        </div>
      );
    }
    case 'text':
    case 'url':
    default:
      return (
        <div className={styles.thumbGlyph}>
          <KindIcon kind={asset.kind} size={34} />
        </div>
      );
  }
}

interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function LibrarySection({ active, onOpenProject }: Props) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [band, setBand] = useState<Band | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [seedFiles, setSeedFiles] = useState<File[] | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const confirmDeleteTitleId = useId();
  // Asset currently being turned into an editable OD page (spinner gate).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid');
  // "Use in design system" menu state (multi-select → design system).
  const [dsMenuOpen, setDsMenuOpen] = useState(false);
  const [dsList, setDsList] = useState<DesignSystemSummary[]>([]);
  const [dsBusy, setDsBusy] = useState(false);
  const dsLoadedRef = useRef(false);
  const dsMenuWrapRef = useRef<HTMLDivElement>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepth = useRef(0);
  const loadedOnce = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; additive: boolean; base: Set<string>; moved: boolean } | null>(
    null,
  );

  const query = useMemo<LibraryAssetQuery>(() => {
    const q: LibraryAssetQuery = {};
    // `element` is a badge identity, not a storage kind (element clips are
    // stored as `image`); narrow to images on the server, then split client-side.
    if (kind) q.kind = kind === 'element' ? 'image' : kind;
    if (source) q.source = source;
    if (search.trim()) q.q = search.trim();
    return q;
  }, [kind, source, search]);

  const load = useCallback(async () => {
    setLoading(true);
    const next = await fetchLibraryAssets(query);
    // Final filtering is badge-aware (shared with the picker) so `image` excludes
    // element captures and `element` keeps only them; other kinds pass through.
    setAssets(next.filter((a) => matchesKindFilter(a, kind as KindFilterValue)));
    setLoading(false);
  }, [query, kind]);

  // Fetch when the tab becomes active or filters change.
  useEffect(() => {
    if (!active) return;
    loadedOnce.current = true;
    void load();
  }, [active, load]);

  // Live updates: clipper captures and deletes refresh the grid.
  useEffect(() => {
    if (!active) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/library/events');
      const refresh = () => void load();
      es.addEventListener('ingest', refresh);
      es.addEventListener('delete', refresh);
    } catch {
      // EventSource unavailable — fall back to manual refresh.
    }
    return () => es?.close();
  }, [active, load]);

  // Drop selected ids that no longer exist after a reload / delete.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set([...prev].filter((id) => assets.some((a) => a.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [assets]);

  const onDelete = useCallback(async (id: string) => {
    const ok = await deleteLibraryAsset(id);
    if (ok) setAssets((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // "Edit as page": turn a captured html asset into a fresh editable OD project
  // and open it on its index.html. The daemon owns the project creation; here we
  // just gate a spinner and navigate on success.
  const handleEditAsPage = useCallback(
    async (assetId: string) => {
      setEditingId(assetId);
      try {
        const result = await editLibraryAssetAsPage(assetId);
        if (result) {
          setPreviewId(null);
          onOpenProject(result.projectId, result.relPath);
        }
      } finally {
        setEditingId(null);
      }
    },
    [onOpenProject],
  );

  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const results = await Promise.all(ids.map((id) => deleteLibraryAsset(id)));
    const deleted = new Set(ids.filter((_, i) => results[i]));
    if (!deleted.size) return;
    setAssets((prev) => prev.filter((a) => !deleted.has(a.id)));
    setSelectedIds(new Set());
    setPreviewId((cur) => (cur && deleted.has(cur) ? null : cur));
  }, [selectedIds]);

  // Bulk delete is destructive and easy to trigger (a button or Delete/
  // Backspace), so it routes through a confirmation dialog instead of removing
  // the selection immediately.
  const requestDeleteSelected = useCallback(() => {
    if (selectedIds.size) setConfirmDeleteOpen(true);
  }, [selectedIds]);

  const confirmDeleteSelected = useCallback(() => {
    setConfirmDeleteOpen(false);
    void deleteSelected();
  }, [deleteSelected]);

  // --- multi-select → design system ---------------------------------------

  // Lazily load the user's own (editable) design systems the first time the
  // "Use in design system" menu opens — these are the ones that can be refined.
  useEffect(() => {
    if (!dsMenuOpen || dsLoadedRef.current) return;
    dsLoadedRef.current = true;
    void fetchDesignSystems().then((list) => setDsList(list.filter((d) => d.source === 'user')));
  }, [dsMenuOpen]);

  // Dismiss the menu on outside click / Escape. Deliberately NOT a full-screen
  // backdrop element: a stray bare overlay can paint opaque (e.g. UA button
  // styling) and blank the whole page behind it.
  useEffect(() => {
    if (!dsMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!dsMenuWrapRef.current?.contains(e.target as Node)) setDsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDsMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [dsMenuOpen]);

  // Path A: open the create-design-system flow pre-seeded with the selected
  // assets as source material (fetched into File objects via a hand-off store).
  const createDesignSystemFromSelection = useCallback(async () => {
    const chosen = assets.filter((a) => selectedIds.has(a.id));
    if (!chosen.length) return;
    setDsBusy(true);
    try {
      const files = (await Promise.all(chosen.map((a) => fetchLibraryAssetAsFile(a)))).filter(
        (f): f is File => f !== null,
      );
      setDesignSystemAssetSeed({ files });
      setDsMenuOpen(false);
      setSelectedIds(new Set());
      navigate({ kind: 'design-system-create' });
    } finally {
      setDsBusy(false);
    }
  }, [assets, selectedIds]);

  // "Chat to design": fetch the selected assets into File objects, hand them to
  // the Home chat composer, and navigate there. The user lands in the creation
  // composer with the assets staged, describes what to build, and Runs to spawn
  // a new project — the assets ride the normal upload-on-Run path. Mirrors the
  // create-design-system File hand-off above, but the destination is Home.
  const chatToDesignFromSelection = useCallback(async () => {
    const chosen = assets.filter((a) => selectedIds.has(a.id));
    if (!chosen.length) return;
    setDsBusy(true);
    try {
      const files = (await Promise.all(chosen.map((a) => fetchLibraryAssetAsFile(a)))).filter(
        (f): f is File => f !== null,
      );
      if (!files.length) return;
      setHomeComposerAssetSeed({ files });
      setSelectedIds(new Set());
      navigate({ kind: 'home', view: 'home' });
    } finally {
      setDsBusy(false);
    }
  }, [assets, selectedIds]);

  // Path B: copy the selected assets into an existing design system's project,
  // stage a composer seed (query + the copied assets as attachments), and open
  // that project so the user can review and Send to refine the system.
  const optimizeExistingDesignSystem = useCallback(
    async (ds: DesignSystemSummary) => {
      const chosen = assets.filter((a) => selectedIds.has(a.id));
      if (!chosen.length) return;
      setDsBusy(true);
      try {
        let projectId = ds.projectId;
        if (!projectId) {
          const detail = await fetchDesignSystem(ds.id);
          projectId = detail?.projectId;
        }
        if (!projectId) {
          setDsMenuOpen(false);
          return;
        }
        const attachments: ChatAttachment[] = [];
        for (const a of chosen) {
          const res = await applyLibraryAsset(a.id, projectId, undefined, { includeElement: true });
          if (res?.relPath) {
            attachments.push({
              path: res.relPath,
              name: res.relPath.split('/').pop() || res.relPath,
              kind: a.kind === 'image' ? 'image' : 'file',
            });
          }
          // An element-pick capture also brings its markup; stage it so the
          // design-system refinement can read the element's HTML, not just the
          // screenshot.
          if (res?.elementRelPath) {
            attachments.push({
              path: res.elementRelPath,
              name: res.elementRelPath.split('/').pop() || res.elementRelPath,
              kind: 'file',
            });
          }
        }
        const n = chosen.length;
        const text =
          `Use ${n} reference${n > 1 ? 's' : ''} I just added from my Library to refine this design ` +
          `system — pull the palette, typography, and component patterns that fit and update the design tokens.`;
        setComposerSeed({ projectId, text, attachments });
        setDsMenuOpen(false);
        setSelectedIds(new Set());
        onOpenProject(projectId);
      } finally {
        setDsBusy(false);
      }
    },
    [assets, selectedIds, onOpenProject],
  );

  const toggleOne = useCallback((id: string, index: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = index;
  }, []);

  const rangeTo = useCallback(
    (index: number) => {
      const anchor = anchorRef.current ?? index;
      const lo = Math.min(anchor, index);
      const hi = Math.max(anchor, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          const a = assets[i];
          if (a) next.add(a.id);
        }
        return next;
      });
    },
    [assets],
  );

  const selectAll = useCallback(() => setSelectedIds(new Set(assets.map((a) => a.id))), [assets]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // --- file upload (drop-anywhere + Upload button) -------------------------
  const openUpload = useCallback((files?: File[]) => {
    setSeedFiles(files && files.length ? files : null);
    setUploadOpen(true);
  }, []);

  // A drag carrying OS files anywhere over the section reveals a drop overlay;
  // dropping seeds the upload modal. enter/leave are depth-counted so child
  // elements don't flicker the overlay. Pure-internal drags (rubber-band box
  // select) never set the `Files` type, so they don't trigger this.
  const dragHasFiles = (e: React.DragEvent) => e.dataTransfer?.types?.includes('Files');
  const onSectionDragEnter = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    fileDragDepth.current += 1;
    setFileDragActive(true);
  }, []);
  const onSectionDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);
  const onSectionDragLeave = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) setFileDragActive(false);
  }, []);
  const onSectionDrop = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      fileDragDepth.current = 0;
      setFileDragActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) openUpload(files);
    },
    [openUpload],
  );

  // --- box selection (rubber band) ----------------------------------------
  const onGridMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Starting on a card is a click / preview gesture, not a box select.
      if (target.closest('[data-asset-card]')) return;
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        additive,
        base: new Set(additive ? selectedIds : []),
        moved: false,
      };
      setBand({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
      setDragging(true);
    },
    [selectedIds],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.moved = true;
      const x = Math.min(d.startX, e.clientX);
      const y = Math.min(d.startY, e.clientY);
      const w = Math.abs(e.clientX - d.startX);
      const h = Math.abs(e.clientY - d.startY);
      setBand({ x, y, w, h });
      const grid = gridRef.current;
      if (!grid) return;
      const next = new Set(d.base);
      const left = x;
      const top = y;
      const right = x + w;
      const bottom = y + h;
      grid.querySelectorAll<HTMLElement>('[data-asset-card]').forEach((el) => {
        const id = el.dataset.assetId;
        if (!id) return;
        const r = el.getBoundingClientRect();
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) next.add(id);
      });
      setSelectedIds(next);
    };
    const up = () => {
      const d = dragRef.current;
      // A click on empty space (no drag) clears the selection.
      if (d && !d.moved && !d.additive) setSelectedIds(new Set());
      dragRef.current = null;
      setDragging(false);
      setBand(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragging]);

  // --- keyboard shortcuts --------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // The upload modal, delete-confirm dialog, and the design-system menu own
      // shortcuts while open.
      if (uploadOpen || confirmDeleteOpen || dsMenuOpen) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        if (typing || !assets.length) return;
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Escape') {
        if (previewId) return; // the preview modal owns Escape while it's open
        if (selectedIds.size) setSelectedIds(new Set());
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing || previewId || !selectedIds.size) return;
        e.preventDefault();
        requestDeleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, assets, selectedIds, previewId, uploadOpen, confirmDeleteOpen, dsMenuOpen, selectAll, requestDeleteSelected]);

  // `@font-face` rules for every font asset on screen, so both the grid
  // thumbnails and the preview specimen render in the real typeface.
  const fontFaceCss = useMemo(
    () =>
      assets
        .filter((a) => a.kind === 'font')
        .map(
          (a) =>
            `@font-face{font-family:"${fontFamilyFor(a.id)}";src:url("${libraryAssetRawUrl(
              a.id,
            )}");font-display:swap;}`,
        )
        .join('\n'),
    [assets],
  );

  const previewIndex = previewId ? assets.findIndex((a) => a.id === previewId) : -1;
  const previewAsset = previewIndex >= 0 ? assets[previewIndex] : null;
  const selectedCount = selectedIds.size;

  // Day-bucketed groups for the timeline view (newest day first). Items keep
  // their flat index in `assets` so range/box selection stays consistent across
  // both views. Grouping by a Map collapses non-contiguous same-day assets.
  const timelineGroups = useMemo(() => {
    const map = new Map<string, Array<{ asset: LibraryAsset; index: number }>>();
    assets.forEach((asset, index) => {
      const key = dayKeyOf(asset);
      const bucket = map.get(key);
      if (bucket) bucket.push({ asset, index });
      else map.set(key, [{ asset, index }]);
    });
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .map(([key, items]) => ({ key, items }));
  }, [assets]);

  // One asset card. Shared by the grid and timeline views; `index` is the flat
  // position in `assets` (drives shift-range + box selection).
  const renderCard = (asset: LibraryAsset, index: number) => {
    const src = primarySource(asset);
    const projectId = originProjectId(asset);
    const title = assetTitle(asset);
    const selected = selectedIds.has(asset.id);
    return (
      <figure
        key={asset.id}
        className={styles.card}
        data-asset-card
        data-asset-id={asset.id}
        data-selected={selected ? 'true' : 'false'}
      >
        <div className={styles.thumb}>
          <Thumb asset={asset} />
          <button
            type="button"
            className={styles.thumbButton}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) {
                toggleOne(asset.id, index);
                return;
              }
              if (e.shiftKey) {
                rangeTo(index);
                return;
              }
              setPreviewId(asset.id);
            }}
            aria-label={`Preview ${title}`}
          >
            <span className={styles.previewOverlay} aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            className={styles.selectCheck}
            data-checked={selected ? 'true' : 'false'}
            aria-pressed={selected}
            aria-label={selected ? 'Deselect asset' : 'Select asset'}
            onClick={(e) => {
              e.stopPropagation();
              if (e.shiftKey) rangeTo(index);
              else toggleOne(asset.id, index);
            }}
          >
            {selected ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : null}
          </button>
          {src ? (
            <span className={styles.badge} data-source={src}>
              {SOURCE_LABELS[src]}
            </span>
          ) : null}
          <span
            className={styles.kindBadge}
            style={{ ['--kind-tint' as string]: kindTint(badgeKind(asset)) }}
          >
            <KindIcon kind={badgeKind(asset)} size={12} />
            {kindLabel(badgeKind(asset))}
          </span>
        </div>
        <figcaption className={styles.meta}>
          <button
            type="button"
            className={styles.title}
            title={asset.sourceTitle ?? asset.sourceUrl ?? asset.id}
            onClick={() => setPreviewId(asset.id)}
          >
            {title}
          </button>
          <span className={styles.sub}>
            {asset.width && asset.height
              ? `${asset.width}×${asset.height}`
              : kindLabel(badgeKind(asset))}
          </span>
        </figcaption>
        <div className={styles.cardActions}>
          {asset.kind === 'html' ? (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => void handleEditAsPage(asset.id)}
              disabled={editingId === asset.id}
            >
              {editingId === asset.id ? 'Opening…' : 'Edit as page'}
            </button>
          ) : projectId ? (
            <button type="button" className={styles.linkBtn} onClick={() => onOpenProject(projectId)}>
              Open project
            </button>
          ) : asset.sourceUrl ? (
            <a className={styles.linkBtn} href={asset.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          ) : (
            <span />
          )}
          <button type="button" className={styles.deleteBtn} onClick={() => void onDelete(asset.id)}>
            Remove
          </button>
        </div>
      </figure>
    );
  };

  return (
    <div
      className={`entry-section ${styles.root}`}
      onDragEnter={onSectionDragEnter}
      onDragOver={onSectionDragOver}
      onDragLeave={onSectionDragLeave}
      onDrop={onSectionDrop}
    >
      {fontFaceCss ? <style>{fontFaceCss}</style> : null}
      <header className="entry-section__head">
        <h1 className="entry-section__title">Library</h1>
        <div className={styles.clipperHint}>
          <p className={styles.headerHint}>
            Clip any page, screenshot, image, or Figma file straight into your Library —
            local-first, one click, no login.
          </p>
          <a
            className={styles.clipperDownload}
            href="https://open-design.ai/clipper"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="download" size={15} />
            Get the Open Design Web Clipper
          </a>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Icon name="search" size={15} className={styles.searchIcon} />
          <input
            className={styles.search}
            type="search"
            placeholder="Search captions, tags, titles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={styles.select} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className={styles.viewToggle} role="group" aria-label="View mode">
          <button
            type="button"
            className={styles.viewToggleBtn}
            data-active={viewMode === 'grid' ? 'true' : 'false'}
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={styles.viewToggleBtn}
            data-active={viewMode === 'timeline' ? 'true' : 'false'}
            aria-pressed={viewMode === 'timeline'}
            onClick={() => setViewMode('timeline')}
          >
            Timeline
          </button>
        </div>
        <Button variant="ghost" className={styles.refreshBtn} onClick={() => void load()} aria-busy={loading}>
          <Icon name="refresh" size={15} className={loading ? styles.spin : undefined} />
          Refresh
        </Button>
        <Button className={styles.uploadBtn} onClick={() => openUpload()}>
          <Icon name="upload" size={15} />
          Upload
        </Button>
      </div>

      {selectedCount > 0 && !dragging ? (
        <div className={styles.selectionBar}>
          <span className={styles.selectionCount}>{selectedCount} selected</span>
          <button type="button" className={styles.selectionLink} onClick={selectAll}>
            Select all
          </button>
          <button type="button" className={styles.selectionLink} onClick={clearSelection}>
            Clear
          </button>
          <span className={styles.selectionSpacer} />
          <button
            type="button"
            className={styles.chatBtn}
            onClick={() => void chatToDesignFromSelection()}
            disabled={dsBusy}
            title={`Start a chat to turn ${selectedCount} into a design`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat to design
          </button>
          <div className={styles.dsMenuWrap} ref={dsMenuWrapRef}>
            <button
              type="button"
              className={styles.dsMenuBtn}
              onClick={() => setDsMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={dsMenuOpen}
              disabled={dsBusy}
            >
              {dsBusy ? 'Working…' : 'Use in design system'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {dsMenuOpen ? (
              <div className={styles.dsMenu} role="menu">
                <button
                  type="button"
                  className={styles.dsMenuItem}
                  role="menuitem"
                  onClick={() => void createDesignSystemFromSelection()}
                >
                  <span className={styles.dsMenuItemTitle}>Create new design system</span>
                  <span className={styles.dsMenuItemSub}>
                    Open the create flow with these {selectedCount} attached
                  </span>
                </button>
                <div className={styles.dsMenuDivider} />
                <div className={styles.dsMenuHeader}>Refine existing</div>
                {dsList.length === 0 ? (
                  <div className={styles.dsMenuEmpty}>No editable design systems yet.</div>
                ) : (
                  dsList.map((ds) => (
                    <button
                      key={ds.id}
                      type="button"
                      className={styles.dsMenuItem}
                      role="menuitem"
                      onClick={() => void optimizeExistingDesignSystem(ds)}
                    >
                      <span className={styles.dsMenuItemTitle}>{ds.title}</span>
                      <span className={styles.dsMenuItemSub}>Add assets & open to refine</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <button type="button" className={styles.selectionDelete} onClick={requestDeleteSelected}>
            Delete {selectedCount}
          </button>
        </div>
      ) : null}

      {loading && assets.length === 0 ? (
        <p className={styles.empty}>Loading…</p>
      ) : assets.length === 0 ? (
        <div className={styles.empty}>
          <p>No assets yet.</p>
          <p className={styles.emptyHint}>
            Clip from any page with the Open Design Web Clipper, run{' '}
            <code>od library import &lt;file&gt;</code>, or upload inside a project — everything
            lands here.
          </p>
        </div>
      ) : viewMode === 'timeline' ? (
        <div
          className={styles.timeline}
          ref={gridRef}
          onMouseDown={onGridMouseDown}
          data-selecting={selectedCount > 0 ? 'true' : 'false'}
        >
          {timelineGroups.map((group) => (
            <section key={group.key} className={styles.timelineDay}>
              <div className={styles.timelineHead}>
                <span className={styles.timelineDot} aria-hidden />
                <h2 className={styles.timelineDate}>{dayHeading(group.key)}</h2>
                <span className={styles.timelineCount}>{group.items.length}</span>
              </div>
              <div className={styles.timelineGrid}>
                {group.items.map(({ asset, index }) => renderCard(asset, index))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div
          className={styles.grid}
          ref={gridRef}
          onMouseDown={onGridMouseDown}
          data-selecting={selectedCount > 0 ? 'true' : 'false'}
        >
          {assets.map((asset, index) => renderCard(asset, index))}
        </div>
      )}

      {band ? (
        <div
          className={styles.band}
          style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
        />
      ) : null}

      {fileDragActive ? (
        <div className={styles.dropOverlay} aria-hidden>
          <div className={styles.dropOverlayInner}>
            <Icon name="upload" size={30} />
            <span className={styles.dropOverlayText}>Drop to upload to your Library</span>
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <LibraryUploadModal
          seedFiles={seedFiles}
          onClose={() => {
            setUploadOpen(false);
            setSeedFiles(null);
          }}
          onUploaded={load}
        />
      ) : null}

      {confirmDeleteOpen ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirmDeleteOpen(false)}
          closeOnEscape
          ariaLabelledBy={confirmDeleteTitleId}
        >
          <DialogTitle id={confirmDeleteTitleId}>
            Delete {selectedCount} {selectedCount === 1 ? 'asset' : 'assets'}?
          </DialogTitle>
          <DialogDescription className="modal-confirm-message">
            This permanently removes {selectedCount === 1 ? 'it' : 'them'} from your Library. This
            can’t be undone.
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary danger" autoFocus onClick={confirmDeleteSelected}>
              Delete {selectedCount}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}

      {previewAsset ? (
        <LibraryPreviewModal
          asset={previewAsset}
          hasPrev={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < assets.length - 1}
          onPrev={() => {
            const prev = assets[previewIndex - 1];
            if (prev) setPreviewId(prev.id);
          }}
          onNext={() => {
            const next = assets[previewIndex + 1];
            if (next) setPreviewId(next.id);
          }}
          onClose={() => setPreviewId(null)}
          onDelete={(id) => {
            void onDelete(id);
            setPreviewId(null);
          }}
          onOpenProject={onOpenProject}
          onEditAsPage={handleEditAsPage}
        />
      ) : null}
    </div>
  );
}
