import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@open-design/components';
import type { BrandSummary } from '@open-design/contracts';
import { useT } from '../i18n';
import { navigate } from '../router';
import { NewBrandModal } from './NewBrandModal';
import styles from './BrandsTab.module.css';

// Best-effort hostname for the card's domain line. Brand names come from the
// extracted kit, but the source URL is always present in meta, so even an
// in-flight / failed brand shows a recognizable label.
function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || rawUrl;
  }
}

async function fetchBrands(): Promise<BrandSummary[]> {
  try {
    const resp = await fetch('/api/brands', { cache: 'no-store' });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { brands?: BrandSummary[] };
    return Array.isArray(data?.brands) ? data.brands : [];
  } catch {
    return [];
  }
}

export function BrandsTab() {
  const t = useT();
  const [brands, setBrands] = useState<BrandSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    const next = await fetchBrands();
    setBrands(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const list = brands ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => {
      const name = b.brand?.name ?? '';
      const host = hostnameOf(b.meta.sourceUrl);
      return name.toLowerCase().includes(q) || host.toLowerCase().includes(q);
    });
  }, [brands, query]);

  const openBrand = useCallback((id: string) => {
    navigate({ kind: 'brand-detail', brandId: id });
  }, []);

  const handleCreated = useCallback(
    (brandId: string, projectId?: string) => {
      setModalOpen(false);
      void refresh();
      if (projectId) {
        try {
          window.sessionStorage.setItem(`od:auto-send-first:${projectId}`, '1');
        } catch {
          // Private-mode storage failures should not block navigation.
        }
        navigate({ kind: 'project', projectId, fileName: null, conversationId: null });
        return;
      }
      openBrand(brandId);
    },
    [refresh, openBrand],
  );

  const isEmpty = brands !== null && (brands ?? []).length === 0;

  return (
    <div className={styles.root} data-testid="brands-tab">
      <header className={styles.header}>
        <div className={styles.headingBlock}>
          <h1 className={styles.title}>{t('brand.libraryTitle')}</h1>
          <p className={styles.subtitle}>{t('brand.librarySubtitle')}</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setModalOpen(true)}
          data-testid="brands-new"
        >
          {t('brand.newBrand')}
        </Button>
      </header>

      {!isEmpty ? (
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.search}
            placeholder={t('brand.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="brands-search"
          />
        </div>
      ) : null}

      {brands === null ? (
        <div className={styles.loading} aria-busy="true" />
      ) : isEmpty ? (
        <div className={styles.empty} data-testid="brands-empty">
          <p className={styles.emptyText}>{t('brand.empty')}</p>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            {t('brand.newBrand')}
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>{t('brand.empty')}</p>
        </div>
      ) : (
        <div className={styles.grid} data-testid="brands-grid">
          {filtered.map((summary) => (
            <BrandCard key={summary.meta.id} summary={summary} onOpen={openBrand} />
          ))}
        </div>
      )}

      <NewBrandModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}

interface CardProps {
  summary: BrandSummary;
  onOpen: (id: string) => void;
}

function BrandCard({ summary, onOpen }: CardProps) {
  const t = useT();
  const { meta, brand } = summary;
  const [logoOk, setLogoOk] = useState(true);
  const host = hostnameOf(meta.sourceUrl);
  const name = brand?.name?.trim() || host;
  const colors = brand?.colors ?? [];
  const swatches = colors.slice(0, 6);
  const status = meta.status;
  const extracting = status === 'extracting';
  const failed = status === 'failed';

  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      data-testid={`brand-card-${meta.id}`}
      onClick={() => onOpen(meta.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(meta.id);
        }
      }}
    >
      <div className={styles.thumb}>
        {logoOk ? (
          <img
            className={styles.logo}
            src={`/api/brands/${encodeURIComponent(meta.id)}/logo`}
            alt=""
            loading="lazy"
            onError={() => setLogoOk(false)}
          />
        ) : (
          <span className={styles.logoFallback} aria-hidden>
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitleRow}>
          <span className={styles.cardName}>{name}</span>
          {extracting ? (
            <span className={`${styles.chip} ${styles.chipBusy}`}>
              {t('brand.extracting')}
            </span>
          ) : failed ? (
            <span className={`${styles.chip} ${styles.chipFailed}`}>
              {t('brand.failed')}
            </span>
          ) : null}
        </div>
        <span className={styles.cardDomain}>{host}</span>
        <div className={styles.cardFooter}>
          {swatches.length > 0 ? (
            <div className={styles.swatches} aria-hidden>
              {swatches.map((c, i) => (
                <span
                  key={`${meta.id}-sw-${i}`}
                  className={styles.swatch}
                  style={{ background: c.hex }}
                  title={c.hex}
                />
              ))}
            </div>
          ) : (
            <span />
          )}
          {colors.length > 0 ? (
            <span className={styles.colorsCount}>
              {t('brand.colorsCount', { count: colors.length })}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
