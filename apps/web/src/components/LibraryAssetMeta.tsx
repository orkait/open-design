// Shared presentational metadata for OD Library assets.
//
// The grid card (LibrarySection) and the preview modal (LibraryPreviewModal)
// both need to label an asset by kind, badge its source, and format its raw
// numbers. Keeping that here avoids two diverging copies of the same map.
//
// Copy is intentionally inline (not yet i18n-keyed) — the Library surface's
// localization is a tracked follow-up, matching LibrarySection.tsx.

import type {
  LibraryAsset,
  LibraryAssetKind,
  LibraryElementMeta,
  LibrarySourceKind,
} from '@open-design/contracts';

export const SOURCE_LABELS: Record<LibrarySourceKind, string> = {
  clipper: 'Clipper',
  'manual-upload': 'Upload',
  'agent-task': 'Agent',
  'design-system': 'Design system',
  generated: 'Generated',
};

/**
 * The badge identity an asset reads as. It is the storage `kind` for everything
 * except clipper element-pick captures: those are stored as `image` assets
 * (a screenshot) enriched with `metadata.element`, but should read as `element`
 * so the badge does not mislabel a captured DOM node as a plain picture.
 */
export type BadgeKind = LibraryAssetKind | 'element';

/** Human label + accent tint for each badge kind, used by the kind badge. */
export const KIND_META: Record<BadgeKind, { label: string; tint: string }> = {
  image: { label: 'Image', tint: '#2563eb' },
  video: { label: 'Video', tint: '#db2777' },
  html: { label: 'HTML', tint: '#d97706' },
  font: { label: 'Font', tint: '#7c3aed' },
  color: { label: 'Color', tint: '#0d9488' },
  text: { label: 'Text', tint: '#475569' },
  url: { label: 'Link', tint: '#0ea5e9' },
  element: { label: 'Element', tint: '#ea580c' },
};

/**
 * The captured DOM element summary for an element-pick clip, or `null` for any
 * other asset. Element clips are `image` assets carrying `metadata.element`.
 */
export function elementMetaOf(asset: LibraryAsset): LibraryElementMeta | null {
  if (asset.kind !== 'image') return null;
  const element = (asset.metadata as { element?: LibraryElementMeta } | undefined)?.element;
  return element ?? null;
}

/** The badge identity for an asset — `element` for element-pick clips, else its `kind`. */
export function badgeKind(asset: LibraryAsset): BadgeKind {
  return elementMetaOf(asset) ? 'element' : asset.kind;
}

/** A badge-aware kind filter value: a badge kind, or `''` for "all kinds". */
export type KindFilterValue = BadgeKind | '';

/**
 * Whether an asset matches a badge-aware kind filter. Filtering keys off
 * {@link badgeKind} rather than the raw storage `kind`, so an element-pick clip
 * — stored as an `image` enriched with `metadata.element` — is matched by the
 * `element` filter and excluded from the plain `image` filter. `''` matches
 * every asset. This is the single rule shared by the Library grid and the
 * "Import from library" picker so both surfaces agree on what each chip shows.
 */
export function matchesKindFilter(asset: LibraryAsset, filter: KindFilterValue): boolean {
  return !filter || badgeKind(asset) === filter;
}

export function kindLabel(kind: BadgeKind): string {
  return KIND_META[kind]?.label ?? kind;
}

export function kindTint(kind: BadgeKind): string {
  return KIND_META[kind]?.tint ?? '#475569';
}

export function primarySource(asset: LibraryAsset): LibrarySourceKind | null {
  return asset.sources?.[0]?.sourceKind ?? null;
}

export function originProjectId(asset: LibraryAsset): string | null {
  if (asset.originProjectId) return asset.originProjectId;
  const fromSource = asset.sources?.find((s) => s.projectId)?.projectId;
  return fromSource ?? null;
}

/** Best display title for an asset, falling back through its provenance. */
export function assetTitle(asset: LibraryAsset): string {
  return (
    asset.sourceTitle ||
    asset.caption ||
    asset.sourceDomain ||
    asset.relPath?.split('/').pop() ||
    `${kindLabel(asset.kind)} · ${asset.id.slice(0, 8)}`
  );
}

export function formatBytes(n?: number): string | null {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(ts?: number): string | null {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

/** CSS `font-family` name for an injected `@font-face` of a font asset. */
export function fontFamilyFor(assetId: string): string {
  return `od-lib-font-${assetId}`;
}

/** First palette swatch, else a hex parsed out of free text, else null. */
export function colorOf(asset: LibraryAsset, rawText?: string | null): string | null {
  const fromPalette = asset.palette?.find((c) => typeof c === 'string' && c.trim());
  if (fromPalette) return fromPalette.trim();
  const text = (rawText ?? '').trim();
  const hex = /#[0-9a-f]{3,8}\b/i.exec(text)?.[0];
  if (hex) return hex;
  const fn = /\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/i.exec(text)?.[0];
  return fn ?? null;
}

interface KindIconProps {
  kind: BadgeKind;
  size?: number;
  className?: string;
}

/** Compact 1.5px-stroke glyph per kind (Lucide-flavoured). */
export function KindIcon({ kind, size = 14, className }: KindIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
  };
  switch (kind) {
    case 'image':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L5 21" />
        </svg>
      );
    case 'video':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'html':
      return (
        <svg {...common}>
          <path d="m8 9-3 3 3 3" />
          <path d="m16 9 3 3-3 3" />
          <path d="M13 7 11 17" />
        </svg>
      );
    case 'font':
      return (
        <svg {...common}>
          <path d="M5 19 12 5l7 14" />
          <path d="M8 13h8" />
        </svg>
      );
    case 'color':
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 1 0 0 18c.83 0 1.5-.67 1.5-1.5a1.5 1.5 0 0 0-.4-1 1.5 1.5 0 0 1 1.1-2.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8Z" />
          <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'url':
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
        </svg>
      );
    case 'element':
      // Box-select / marquee glyph — a captured DOM region, not a flat picture.
      return (
        <svg {...common}>
          <path d="M5 3a2 2 0 0 0-2 2" />
          <path d="M19 3a2 2 0 0 1 2 2" />
          <path d="M21 19a2 2 0 0 1-2 2" />
          <path d="M5 21a2 2 0 0 1-2-2" />
          <path d="M9 3h1M14 3h1" />
          <path d="M9 21h1M14 21h1" />
          <path d="M3 9v1M3 14v1" />
          <path d="M21 9v1M21 14v1" />
        </svg>
      );
    case 'text':
    default:
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h10" />
        </svg>
      );
  }
}
