/* ──────────────────────────────────────────────────────────────────
   HealthBanner — warn + self-heal strip for the environment health-check.

   Shown at the top of the MAIN shell (never during first-run SetupScreen)
   when GET /api/health reports something missing. It names exactly what is
   missing and REPAIRS by re-fetching ONLY the missing pieces, reusing any
   cached files:

     • missing MODELS → useModels.downloadAndTrack(id)  (per missing id)
     • missing DEPS   → useSetup.runSetup()             (pip skips installed)

   Behavior by severity:
     • REQUIRED missing → blocks core use, so repair AUTO-STARTS on first
       detection (visible progress + a Cancel). The banner cannot be
       dismissed away while required pieces are missing.
     • OPTIONAL-only missing → warn + a manual "Repair" button (we never
       auto-download big optional models). Dismiss is persisted to
       localStorage so a dismissed optional warning does not nag on reload.

   On repair success we refresh health + meta + models so the banner clears.

   Aggregated progress reuses useModels.perId (per-model pct) and the
   useSetup progress (deps/venv) — this component never reimplements any
   download.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, Wrench, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button, ProgressBar } from '../primitives';
import { useHealth } from '../../state/useHealth';
import type { HealthMissing } from '../../api/health';
import { useModels } from '../../state/useModels';
import { useSetup } from '../../state/useSetup';
import { useMeta } from '../../state/useMeta';
import { useT } from '../../i18n';
import type { TFn } from '../../i18n';
import './health.css';

/** localStorage key holding a `|`-joined signature of dismissed OPTIONAL sets. */
const DISMISS_KEY = 'al-health-dismissed';

/* ── label / reason localization ───────────────────────────────────── */

/** Friendly localized label for a missing item, falling back to its API label. */
function labelFor(t: TFn, m: HealthMissing): string {
  // Whisper models share one label key regardless of size suffix.
  const key = m.id.startsWith('whisper') ? 'health.label.whisper' : `health.label.${m.id}`;
  const localized = t(key);
  // makeT returns the key itself when missing → detect that and fall back.
  if (localized !== key) return localized;
  return m.label || m.id;
}

/** Localized reason ("…需要"), falling back to the raw reason text. */
function reasonFor(t: TFn, m: HealthMissing): string | null {
  if (!m.reason) return null;
  const key = `health.reason.${m.reason}`;
  const localized = t(key);
  if (localized !== key) return localized;
  return m.reason;
}

/** "缺少：A（理由）、B、C" — enumerate missing items with optional reasons. */
function enumerate(t: TFn, items: HealthMissing[]): string {
  const join = t('health.listJoin');
  return items
    .map((m) => {
      const reason = reasonFor(t, m);
      const lbl = labelFor(t, m);
      return reason ? `${lbl}（${reason}）` : lbl;
    })
    .join(join);
}

/** Stable signature of a missing set (sorted ids) for the dismiss memory. */
function signatureOf(items: HealthMissing[]): string {
  return items
    .map((m) => m.id)
    .sort()
    .join('|');
}

function loadDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveDismissed(sig: string) {
  try {
    localStorage.setItem(DISMISS_KEY, sig);
  } catch {
    /* private mode — ignore */
  }
}

/* ── component ─────────────────────────────────────────────────────── */

export function HealthBanner() {
  const t = useT();

  // ── health report (subscribe granularly) ──
  // Subscribe to the STABLE `missing` array (a single stored reference that only
  // changes on refresh) and derive the sub-lists with useMemo. Selecting via the
  // `.filter()`-based selectors directly would return a NEW array every render →
  // useSyncExternalStore's "getSnapshot should be cached" infinite-loop warning.
  const loaded = useHealth((s) => s.loaded);
  const missing = useHealth((s) => s.missing);
  const refreshHealth = useHealth((s) => s.refresh);

  const missingRequired = useMemo(() => missing.filter((m) => m.required), [missing]);
  const missingOptional = useMemo(() => missing.filter((m) => !m.required), [missing]);
  const missingModels = useMemo(() => missing.filter((m) => m.category === 'model'), [missing]);
  const missingDeps = useMemo(() => missing.filter((m) => m.category === 'dep'), [missing]);

  // ── download / setup machinery (reused, never reimplemented) ──
  const perId = useModels((s) => s.perId);
  const downloadAndTrack = useModels((s) => s.downloadAndTrack);
  const loadModels = useModels((s) => s.load);
  const inTauri = useSetup((s) => s.inTauri);
  const setupRunning = useSetup((s) => s.running);
  const setupPct = useSetup((s) => s.pct);
  const setupDone = useSetup((s) => s.done);
  const setupError = useSetup((s) => s.error);
  const runSetup = useSetup((s) => s.runSetup);
  const loadMeta = useMeta((s) => s.load);

  // ── local UI state ──
  const [repairing, setRepairing] = useState(false);
  const [dismissedSig, setDismissedSig] = useState<string>(() => loadDismissed());
  const [justRepaired, setJustRepaired] = useState(false);

  const hasRequired = missingRequired.length > 0;
  const hasOptional = missingOptional.length > 0;
  const optionalSig = useMemo(() => signatureOf(missingOptional), [missingOptional]);

  // Which deps the active repair is healing (we only runSetup when deps missing).
  const repairingDepsRef = useRef(false);

  // ── repair: fetch ONLY the missing pieces ───────────────────────────
  const repair = useCallback(
    async (items: { models: HealthMissing[]; deps: HealthMissing[] }) => {
      if (repairing) return;
      setRepairing(true);
      setJustRepaired(false);

      // Kick off every missing MODEL download in parallel (each polls itself
      // via useModels; pip-style "already present" never re-downloads).
      for (const m of items.models) {
        void downloadAndTrack(m.id);
      }

      // Heal missing DEPS via the venv setup (only inside Tauri; pip skips
      // already-installed packages, so this fetches just what's absent).
      repairingDepsRef.current = items.deps.length > 0 && inTauri;
      if (repairingDepsRef.current) {
        void runSetup();
      }
    },
    [repairing, downloadAndTrack, runSetup, inTauri],
  );

  // ── AUTO-START repair when a REQUIRED item is first detected ─────────
  // Re-arm whenever the required signature changes (e.g. a model deleted
  // later), but never while a repair is already running.
  const autoStartedSig = useRef<string>('');
  const requiredSig = useMemo(() => signatureOf(missingRequired), [missingRequired]);
  useEffect(() => {
    if (!loaded || repairing) return;
    if (autoStartedSig.current === requiredSig) return;
    // Auto-repair ONLY missing required DEPS. NEVER auto-download models here —
    // each model fetches on demand the first time a feature actually needs it,
    // so auto-pulling every "required" model would download several GB (whisper
    // + demucs + aligner …) the user may never use. Missing models are surfaced
    // as a dismissible note instead, with a manual download.
    const reqDeps = missingDeps.filter((m) => m.required);
    if (reqDeps.length === 0) return;
    autoStartedSig.current = requiredSig;
    void repair({ models: [], deps: reqDeps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, requiredSig, repairing]);

  // ── aggregated progress across model downloads + setup ───────────────
  // Build the set of model ids currently being repaired (those with a
  // perId entry that correspond to a missing model id).
  const repairModelIds = useMemo(
    () => missingModels.map((m) => m.id),
    [missingModels],
  );

  const { activeCount, doneCount, totalCount, aggPct, anyError } = useMemo(() => {
    const ids = repairModelIds;
    let pctSum = 0;
    let done = 0;
    let active = 0;
    let errored = false;
    for (const id of ids) {
      const p = perId[id];
      if (!p) {
        // No progress entry → either not started or already finished+cleared.
        continue;
      }
      if (p.status === 'error') errored = true;
      if (p.status === 'done') {
        done += 1;
        pctSum += 100;
      } else {
        active += 1;
        pctSum += p.pct;
      }
    }
    // Include the deps/setup leg in the aggregate when it's part of this repair.
    const depsLeg = repairingDepsRef.current ? 1 : 0;
    const total = ids.length + depsLeg;
    if (depsLeg) {
      if (setupError) errored = true;
      if (setupDone) {
        done += 1;
        pctSum += 100;
      } else if (setupRunning) {
        active += 1;
        pctSum += setupPct;
      }
    }
    const pct = total > 0 ? Math.round(pctSum / total) : 0;
    return { activeCount: active, doneCount: done, totalCount: total, aggPct: pct, anyError: errored };
  }, [perId, repairModelIds, setupRunning, setupPct, setupDone, setupError]);

  // ── detect repair completion → refresh everything so the banner clears ─
  const wasRepairing = useRef(false);
  useEffect(() => {
    if (!repairing) {
      wasRepairing.current = false;
      return;
    }
    wasRepairing.current = true;

    // Still working if any tracked model is running, or the deps setup is.
    const modelsBusy = repairModelIds.some((id) => perId[id]?.status === 'running');
    const depsBusy = repairingDepsRef.current && setupRunning;
    if (modelsBusy || depsBusy) return;

    // Nothing in flight anymore → settle. Refresh health/meta/models so a
    // successful repair clears the missing list (and thus this banner).
    let cancelled = false;
    void (async () => {
      await Promise.all([loadModels(), loadMeta()]);
      if (cancelled) return;
      await refreshHealth();
      if (cancelled) return;
      repairingDepsRef.current = false;
      setRepairing(false);
      if (!anyError) {
        setJustRepaired(true);
        window.setTimeout(() => setJustRepaired(false), 4000);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairing, perId, setupRunning, anyError]);

  // ── manual handlers ──
  const onRepairAll = useCallback(() => {
    void repair({ models: missingModels, deps: missingDeps });
  }, [repair, missingModels, missingDeps]);

  const onDismissOptional = useCallback(() => {
    setDismissedSig(optionalSig);
    saveDismissed(optionalSig);
  }, [optionalSig]);

  const onRecheck = useCallback(() => {
    void refreshHealth();
  }, [refreshHealth]);

  // ── visibility gate ──────────────────────────────────────────────────
  // Show only after a report has loaded and something is actually missing.
  const nothingMissing = !hasRequired && !hasOptional;

  // Brief "已修復" confirmation right after a clean repair.
  if (justRepaired && nothingMissing) {
    return (
      <div className="al-health-banner al-health-banner--ok" role="status" aria-live="polite">
        <CheckCircle2 size={15} className="al-health-banner__icon al-health-banner__icon--ok" aria-hidden />
        <span className="al-health-banner__msg">{t('health.repaired')}</span>
      </div>
    );
  }

  if (!loaded || nothingMissing) return null;

  // Optional-only AND the user dismissed exactly this set → stay quiet
  // (unless a repair is mid-flight, which we always surface).
  if (!hasRequired && !repairing && dismissedSig === optionalSig && optionalSig) {
    return null;
  }

  const severity: 'required' | 'optional' = hasRequired ? 'required' : 'optional';
  const allMissing = [...missingRequired, ...missingOptional];

  // ── render: active repair (progress) ─────────────────────────────────
  if (repairing) {
    const progressLabel = t('health.progressLabel', { pct: String(aggPct) });
    const indeterminate = activeCount > 0 && aggPct === 0;
    return (
      <div
        className="al-health-banner al-health-banner--progress"
        role="status"
        aria-live="polite"
        aria-label={progressLabel}
      >
        <Wrench size={15} className="al-health-banner__icon" aria-hidden />
        <div className="al-health-banner__body">
          <span className="al-health-banner__heading">
            {totalCount > 0
              ? t('health.repairingProgress', { done: String(doneCount), total: String(totalCount) })
              : t('health.repairing')}
          </span>
          {repairingDepsRef.current && setupRunning && (
            <span className="al-health-banner__notes">{t('health.installingDeps')}</span>
          )}
        </div>
        <ProgressBar
          value={aggPct}
          indeterminate={indeterminate}
          tone="gold"
          className="al-health-banner__bar"
        />
      </div>
    );
  }

  // ── render: error after a repair attempt ─────────────────────────────
  if (anyError) {
    return (
      <div className="al-health-banner al-health-banner--error" role="alert" aria-live="assertive">
        <AlertTriangle size={15} className="al-health-banner__icon al-health-banner__icon--error" aria-hidden />
        <span className="al-health-banner__msg">{t('health.repairFailedRetry')}</span>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={13} />}
          onClick={onRepairAll}
          aria-label={t('common.action.retry')}
        >
          {t('common.action.retry')}
        </Button>
      </div>
    );
  }

  // ── render: warn (required → amber; optional → quieter gold) ──────────
  const headingKey = severity === 'required' ? 'health.titleRequired' : 'health.titleOptional';
  const bodyKey = severity === 'required' ? 'health.requiredBody' : 'health.optionalBody';
  const enumerated = t('health.missingPrefix') + enumerate(t, allMissing);

  return (
    <div
      className={`al-health-banner al-health-banner--${severity}`}
      role={severity === 'required' ? 'alert' : 'status'}
      aria-live={severity === 'required' ? 'assertive' : 'polite'}
      aria-label={t('health.bannerAria')}
    >
      {severity === 'required' ? (
        <AlertTriangle size={15} className="al-health-banner__icon al-health-banner__icon--amber" aria-hidden />
      ) : (
        <Info size={15} className="al-health-banner__icon al-health-banner__icon--gold" aria-hidden />
      )}

      <div className="al-health-banner__body">
        <span className="al-health-banner__heading">{t(headingKey)}</span>
        <span className="al-health-banner__notes" title={enumerated}>
          {enumerated}
        </span>
        <span className="al-health-banner__sub">{t(bodyKey)}</span>
      </div>

      <div className="al-health-banner__actions">
        <Button
          variant="primary"
          size="sm"
          icon={<Wrench size={13} />}
          onClick={onRepairAll}
          aria-label={t('health.repair')}
        >
          {severity === 'required' ? t('health.repair') : t('health.repairAll')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={13} />}
          onClick={onRecheck}
          aria-label={t('health.recheck')}
        >
          {t('health.recheck')}
        </Button>
      </div>

      {/* Dismiss only offered for OPTIONAL-only warnings (required can't be
          waved away while core features are broken). */}
      {severity === 'optional' && (
        <button
          type="button"
          className="al-health-banner__dismiss"
          onClick={onDismissOptional}
          aria-label={t('health.dismiss')}
          title={t('health.dismiss')}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
