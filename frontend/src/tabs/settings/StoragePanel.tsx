/* ──────────────────────────────────────────────────────────────────
   StoragePanel — Settings → 儲存空間 (Storage).

   Lets the user free disk space in TIERS instead of an all-or-nothing
   nuke. Top: a usage breakdown (backend env + models + cache path +
   grand total). Below: four tiers, each with an explicit two-step
   inline confirm and a note of how much it frees:

     1. Delete a single model — already in the Model Manager above; we
        only POINT to it (no duplication).
     2. Clear all models (keep app)   → clearAllModels()        · amber
     3. Full reset · keep models      → reset_backend(false)    · red
     4. Full reset · also del models  → clearAllModels() then
                                        reset_backend(true)     · red

   The two "Full reset" tiers invoke the Tauri `reset_backend` command,
   so they only make sense in the desktop shell. In a plain browser they
   are disabled with a "桌面版可用" hint (inTauri from useSetup).

   After each action we refresh the stores that drive the rest of the UI:
     • clear-all     → useModels.load() + local getStorage()
     • reset (both)  → useSetup.checkStatus() (venv gone → SetupScreen)
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  HardDrive,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Button } from '../../components/primitives';
import { getStorage, clearAllModels } from '../../api/storage';
import type { StorageBreakdown } from '../../api/storage';
import { useModels } from '../../state/useModels';
import { useSetup } from '../../state/useSetup';
import { ApiError } from '../../api/client';
import { useT } from '../../i18n';
import type { TFn } from '../../i18n';

/* ── size formatting (MB → friendly GB/MB) ──────────────────────────── */
function fmtSize(mb: number | null | undefined): string {
  const v = mb ?? 0;
  if (v <= 0) return '0 MB';
  if (v >= 1024) return `${(v / 1024).toFixed(1)} GB`;
  return `${Math.round(v)} MB`;
}

/* ── a single tiered action row, with its own two-step inline confirm ── */

type Tone = 'amber' | 'red';

interface ActionRowProps {
  title: string;
  body: string;
  /** Localized "Frees N GB" line (or null to hide). */
  freesLabel: string | null;
  actionLabel: string;
  confirmText: string;
  tone: Tone;
  /** Disabled with a hint (e.g. desktop-only, or nothing to clear). */
  disabled?: boolean;
  disabledHint?: string | null;
  /** Runs the destructive action; resolves when done. Throws on failure. */
  onRun: () => Promise<void>;
}

function ActionRow({
  title,
  body,
  freesLabel,
  actionLabel,
  confirmText,
  tone,
  disabled = false,
  disabledHint = null,
  onRun,
}: ActionRowProps) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = useCallback(() => {
    setConfirming(false);
    setBusy(false);
    setErr(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await onRun();
      // Success: the parent refreshes the breakdown / flips to SetupScreen.
      setConfirming(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('storage.error.generic');
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [onRun, t]);

  return (
    <div className={`al-storage-action al-storage-action--${tone}`}>
      <div className="al-storage-action__body">
        <div className="al-storage-action__title">{title}</div>
        <p className="al-storage-action__desc">{body}</p>
        {freesLabel && <span className="al-storage-action__frees">{freesLabel}</span>}
        {disabled && disabledHint && (
          <span className="al-storage-action__locked">{disabledHint}</span>
        )}
        {err && (
          <span className="al-storage-action__err" role="alert" aria-live="assertive">
            <AlertTriangle size={12} /> {err}
          </span>
        )}
      </div>

      <div className="al-storage-action__ctl">
        {!confirming ? (
          <Button
            variant={tone === 'red' ? 'danger' : 'default'}
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={() => {
              setErr(null);
              setConfirming(true);
            }}
            disabled={disabled}
            className={tone === 'amber' ? 'al-storage-btn--amber' : ''}
          >
            {actionLabel}
          </Button>
        ) : (
          <div className="al-storage-confirm" role="group">
            <span className="al-storage-confirm__q">{confirmText}</span>
            <div className="al-storage-confirm__row">
              <Button
                variant={tone === 'red' ? 'danger' : 'default'}
                size="sm"
                icon={busy ? <Loader2 size={14} className="al-spin" /> : <Trash2 size={14} />}
                onClick={() => void handleConfirm()}
                disabled={busy}
                className={tone === 'amber' ? 'al-storage-btn--amber' : ''}
              >
                {busy ? t('storage.working') : t('storage.confirmStep')}
              </Button>
              <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                {t('storage.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── usage breakdown block ───────────────────────────────────────────── */

function UsageBreakdown({
  t,
  data,
  loading,
  offline,
  onRefresh,
}: {
  t: TFn;
  data: StorageBreakdown | null;
  loading: boolean;
  offline: boolean;
  onRefresh: () => void;
}) {
  if (offline && !data) {
    return (
      <div className="al-panel al-storage-usage al-storage-usage--msg">
        <span>{t('storage.usage.offline')}</span>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={onRefresh}>
          {t('common.action.retry')}
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="al-panel al-storage-usage al-storage-usage--msg">
        <Loader2 size={15} className="al-spin" />
        <span>{t('storage.usage.loading')}</span>
      </div>
    );
  }

  const installed = data.models.filter((m) => m.installed && m.sizeOnDiskMB > 0);
  const total = data.totalMB || 0;
  const venvPct = total > 0 ? (data.venvMB / total) * 100 : 0;
  const modelsPct = total > 0 ? (data.modelsMB / total) * 100 : 0;

  return (
    <div className="al-panel al-storage-usage">
      {/* Grand total + stacked proportion bar */}
      <div className="al-storage-usage__head">
        <span className="al-storage-usage__totallabel">{t('storage.usage.total')}</span>
        <strong className="al-storage-usage__totalval">{fmtSize(total)}</strong>
        <button
          type="button"
          className="al-storage-usage__refresh"
          onClick={onRefresh}
          title={t('storage.usage.refreshTitle')}
          aria-label={t('storage.usage.refreshTitle')}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? 'al-spin' : ''} />
        </button>
      </div>
      <div className="al-storage-bar" aria-hidden="true">
        <span className="al-storage-bar__seg al-storage-bar__seg--venv" style={{ width: `${venvPct}%` }} />
        <span className="al-storage-bar__seg al-storage-bar__seg--models" style={{ width: `${modelsPct}%` }} />
      </div>

      {/* Line items */}
      <dl className="al-storage-usage__items">
        <div className="al-storage-usage__item">
          <dt>
            <span className="al-storage-dot al-storage-dot--venv" aria-hidden="true" />
            {t('storage.usage.venv')}
            <em className="al-storage-usage__hint">{t('storage.usage.venvHint')}</em>
          </dt>
          <dd>{fmtSize(data.venvMB)}</dd>
        </div>
        <div className="al-storage-usage__item">
          <dt>
            <span className="al-storage-dot al-storage-dot--models" aria-hidden="true" />
            {t('storage.usage.models')}
            <em className="al-storage-usage__hint">{t('storage.usage.modelsHint')}</em>
          </dt>
          <dd>{fmtSize(data.modelsMB)}</dd>
        </div>
      </dl>

      {/* Per-model footprint */}
      {installed.length > 0 ? (
        <ul className="al-storage-models">
          {installed.map((m) => (
            <li key={m.id} className="al-storage-models__row">
              <span className="al-storage-models__name" title={m.id}>
                <Package size={11} /> {m.label}
              </span>
              <span className="al-storage-models__size">{fmtSize(m.sizeOnDiskMB)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="al-storage-models__empty">{t('storage.usage.empty')}</div>
      )}

      {/* Cache dir path */}
      <div className="al-storage-usage__cache">
        <span className="al-storage-usage__cachelabel">
          <HardDrive size={11} /> {t('storage.usage.cacheDir')}
        </span>
        <code title={data.cacheDir}>{data.cacheDir}</code>
        <span className="al-storage-usage__cachenote">{t('storage.usage.cacheNote')}</span>
      </div>
    </div>
  );
}

/* ── panel ───────────────────────────────────────────────────────────── */

export function StoragePanel() {
  const t = useT();

  // Reused stores (never reimplemented).
  const loadModels = useModels((s) => s.load);
  const inTauri = useSetup((s) => s.inTauri);
  const checkStatus = useSetup((s) => s.checkStatus);

  // Local breakdown state (this panel owns it; not a global store).
  const [data, setData] = useState<StorageBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getStorage();
      setData(next);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.offline) setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── tier runners ──────────────────────────────────────────────────────
  // Tier 2 — clear all models, keep the app. Refresh models + breakdown.
  const runClearModels = useCallback(async () => {
    await clearAllModels();
    await Promise.all([loadModels(), refresh()]);
  }, [loadModels, refresh]);

  // Tier 3 — full reset, keep models. venv gone → SetupScreen returns.
  const runResetKeep = useCallback(async () => {
    await invoke('reset_backend', { deleteModels: false });
    await checkStatus();
  }, [checkStatus]);

  // Tier 4 — clear models FIRST, then reset the venv. Strongest.
  const runResetAll = useCallback(async () => {
    await clearAllModels();
    await invoke('reset_backend', { deleteModels: true });
    await checkStatus();
  }, [checkStatus]);

  // ── derived freed-space hints ─────────────────────────────────────────
  const modelsMB = data?.modelsMB ?? 0;
  const venvMB = data?.venvMB ?? 0;
  const totalMB = data?.totalMB ?? 0;
  const hasModels = modelsMB > 0;

  const freesModels = data ? t('storage.frees', { size: fmtSize(modelsMB) }) : null;
  const freesVenv = data ? t('storage.frees', { size: fmtSize(venvMB) }) : null;
  const freesAll = data ? t('storage.frees', { size: fmtSize(totalMB) }) : null;

  return (
    <div className="al-storage">
      <UsageBreakdown
        t={t}
        data={data}
        loading={loading}
        offline={offline}
        onRefresh={() => void refresh()}
      />

      {/* Tier 1 — pointer to the single-model delete in the Model Manager */}
      <div className="al-storage-note">
        <RotateCcw size={13} className="al-storage-note__icon" />
        <div>
          <div className="al-storage-note__title">{t('storage.single.title')}</div>
          <p className="al-storage-note__body">{t('storage.single.body')}</p>
        </div>
      </div>

      {/* Tier 2 — clear all models (keep app) · amber */}
      <ActionRow
        title={t('storage.clearModels.title')}
        body={t('storage.clearModels.body')}
        freesLabel={hasModels ? freesModels : null}
        actionLabel={t('storage.clearModels.action')}
        confirmText={t('storage.clearModels.confirm')}
        tone="amber"
        disabled={!!data && !hasModels}
        disabledHint={!!data && !hasModels ? t('storage.clearModels.empty') : null}
        onRun={runClearModels}
      />

      {/* Tier 3 — full reset · keep models · red, Tauri-only */}
      <ActionRow
        title={t('storage.resetKeep.title')}
        body={t('storage.resetKeep.body')}
        freesLabel={freesVenv}
        actionLabel={t('storage.resetKeep.action')}
        confirmText={t('storage.resetKeep.confirm')}
        tone="red"
        disabled={!inTauri}
        disabledHint={!inTauri ? t('storage.desktopOnlyHint') : null}
        onRun={runResetKeep}
      />

      {/* Tier 4 — full reset · also delete models · red, Tauri-only, strongest */}
      <ActionRow
        title={t('storage.resetAll.title')}
        body={t('storage.resetAll.body')}
        freesLabel={freesAll}
        actionLabel={t('storage.resetAll.action')}
        confirmText={t('storage.resetAll.confirm')}
        tone="red"
        disabled={!inTauri}
        disabledHint={!inTauri ? t('storage.desktopOnlyHint') : null}
        onRun={runResetAll}
      />
    </div>
  );
}
