import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@open-design/components';
import type { BrandDetailResponse, BrandFontSpec } from '@open-design/contracts';
import { useT } from '../i18n';
import { navigate } from '../router';
import styles from './BrandDetailView.module.css';

interface Props {
  brandId: string;
}

function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || rawUrl;
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; detail: BrandDetailResponse }
  | { status: 'not-found' };

export function BrandDetailView({ brandId }: Props) {
  const t = useT();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  const fetchDetail = useCallback(async () => {
    try {
      const resp = await fetch(`/api/brands/${encodeURIComponent(brandId)}`, {
        cache: 'no-store',
      });
      if (resp.status === 404) {
        setLoad({ status: 'not-found' });
        return;
      }
      if (!resp.ok) {
        setLoad({ status: 'not-found' });
        return;
      }
      const detail = (await resp.json()) as BrandDetailResponse;
      setLoad({ status: 'ready', detail });
    } catch {
      setLoad({ status: 'not-found' });
    }
  }, [brandId]);

  useEffect(() => {
    setLoad({ status: 'loading' });
    setLogoOk(true);
    void fetchDetail();
  }, [fetchDetail]);

  const goBack = useCallback(() => {
    navigate({ kind: 'home', view: 'brands' });
  }, []);

  const detail = load.status === 'ready' ? load.detail : null;
  const meta = detail?.meta ?? null;
  const brand = detail?.brand ?? null;
  const host = meta ? hostnameOf(meta.sourceUrl) : '';
  const name = brand?.name?.trim() || host;
  const refining = meta?.status === 'extracting';

  const useInChat = useCallback(async () => {
    if (!meta?.designSystemId || busy) return;
    setBusy(true);
    try {
      // The brand registered a `user:<id>` design system; reuse the existing
      // design-system apply flow by writing the global default into app-config.
      await fetch('/api/app-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designSystemId: meta.designSystemId }),
      });
      navigate({ kind: 'home', view: 'home' });
    } catch {
      setBusy(false);
    }
  }, [meta?.designSystemId, busy]);

  const openProject = useCallback(() => {
    if (!meta?.projectId) return;
    navigate({ kind: 'project', projectId: meta.projectId, fileName: null, conversationId: null });
  }, [meta?.projectId]);

  const deleteBrand = useCallback(async () => {
    if (busy) return;
    const ok = window.confirm(`Delete "${name}"? This removes the brand and its design system.`);
    if (!ok) return;
    setBusy(true);
    try {
      await fetch(`/api/brands/${encodeURIComponent(brandId)}`, { method: 'DELETE' });
      navigate({ kind: 'home', view: 'brands' });
    } catch {
      setBusy(false);
    }
  }, [busy, brandId, name]);

  const colors = brand?.colors ?? [];
  const fonts = useMemo<{ font: BrandFontSpec; label: string }[]>(() => {
    if (!brand) return [];
    const out: { font: BrandFontSpec; label: string }[] = [];
    if (brand.typography.display) out.push({ font: brand.typography.display, label: 'Display' });
    if (brand.typography.body) out.push({ font: brand.typography.body, label: 'Body' });
    if (brand.typography.mono) out.push({ font: brand.typography.mono, label: 'Mono' });
    return out;
  }, [brand]);
  const adjectives = brand?.voice?.adjectives ?? [];
  const aesthetic = brand?.imagery?.style?.trim() || brand?.voice?.tone?.trim() || '';

  return (
    <div className={styles.root} data-testid="brand-detail">
      <div className={styles.topbar}>
        <button type="button" className={styles.back} onClick={goBack} data-testid="brand-detail-back">
          <BackGlyph />
          <span>{t('brandDetail.back')}</span>
        </button>
      </div>

      {load.status === 'loading' ? (
        <div className={styles.loading} aria-busy="true" />
      ) : load.status === 'not-found' ? (
        <div className={styles.notFound} data-testid="brand-detail-not-found">
          {t('brandDetail.notFound')}
        </div>
      ) : (
        <>
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <div className={styles.headerLogo}>
                {logoOk ? (
                  <img
                    className={styles.headerLogoImg}
                    src={`/api/brands/${encodeURIComponent(brandId)}/logo`}
                    alt=""
                    onError={() => setLogoOk(false)}
                  />
                ) : (
                  <span className={styles.headerLogoFallback} aria-hidden>
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div className={styles.headerText}>
                <div className={styles.headerTitleRow}>
                  <h1 className={styles.headerName}>{name}</h1>
                  {refining ? (
                    <span className={styles.refining} role="status">
                      {t('brandDetail.refining')}
                    </span>
                  ) : null}
                </div>
                <span className={styles.headerDomain}>{host}</span>
              </div>
            </div>
            <div className={styles.headerActions}>
              <Button
                variant="primary"
                onClick={() => void useInChat()}
                disabled={busy || !meta?.designSystemId}
                data-testid="brand-detail-use"
              >
                {t('brandDetail.useInChat')}
              </Button>
              {meta?.projectId ? (
                <Button
                  variant="ghost"
                  onClick={openProject}
                  disabled={busy}
                  data-testid="brand-detail-open-project"
                >
                  Open project
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => void deleteBrand()}
                disabled={busy}
                data-testid="brand-detail-delete"
              >
                {t('brandDetail.delete')}
              </Button>
            </div>
          </header>

          {/* ── Identity ───────────────────────────────────────────── */}
          <section className={styles.card} aria-label={t('brandDetail.identity')}>
            <h2 className={styles.cardTitle}>{t('brandDetail.identity')}</h2>
            <div className={styles.identityBody}>
              {brand?.description ? (
                <p className={styles.description}>{brand.description}</p>
              ) : null}
              {brand?.tagline ? (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t('brandDetail.tagline')}</span>
                  <span className={styles.tagline}>{brand.tagline}</span>
                </div>
              ) : null}
            </div>
          </section>

          {/* ── Design Language ────────────────────────────────────── */}
          <section className={styles.card} aria-label={t('brandDetail.designLanguage')}>
            <h2 className={styles.cardTitle}>{t('brandDetail.designLanguage')}</h2>

            {colors.length > 0 ? (
              <div className={styles.subsection}>
                <h3 className={styles.subTitle}>{t('brandDetail.colors')}</h3>
                <div className={styles.colorGrid}>
                  {colors.map((c, i) => (
                    <div key={`${c.role}-${i}`} className={styles.colorItem}>
                      <span className={styles.colorSwatch} style={{ background: c.hex }} />
                      <span className={styles.colorName}>{c.name || c.role}</span>
                      <span className={styles.colorHex}>{c.hex}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {fonts.length > 0 ? (
              <div className={styles.subsection}>
                <h3 className={styles.subTitle}>{t('brandDetail.fonts')}</h3>
                <div className={styles.fontList}>
                  {fonts.map(({ font, label }) => (
                    <div key={`${label}-${font.family}`} className={styles.fontItem}>
                      <span
                        className={styles.fontSpecimen}
                        style={{ fontFamily: `'${font.family}', ${font.fallbacks.join(', ') || 'sans-serif'}` }}
                      >
                        Aa Bb Cc
                      </span>
                      <span className={styles.fontMeta}>
                        <span className={styles.fontFamily}>{font.family}</span>
                        <span className={styles.fontRole}>{label}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {adjectives.length > 0 ? (
              <div className={styles.subsection}>
                <h3 className={styles.subTitle}>{t('brandDetail.tone')}</h3>
                <div className={styles.pills}>
                  {adjectives.map((adj, i) => (
                    <span key={`${adj}-${i}`} className={styles.pill}>
                      {adj}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {aesthetic ? (
              <div className={styles.subsection}>
                <h3 className={styles.subTitle}>{t('brandDetail.aesthetic')}</h3>
                <p className={styles.aesthetic}>{aesthetic}</p>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function BackGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path
        d="M10 3.5L5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
