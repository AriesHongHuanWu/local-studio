import { useEffect, useState } from 'react';
import { AppFrame } from './components/shell/AppFrame';
import { TabRail } from './components/shell/TabRail';
import { StatusStrip } from './components/shell/StatusStrip';
import type { TabKey } from './components/shell/tabs';
import { tabsForMode } from './components/shell/tabs';
import { TranscribeTab } from './tabs/transcribe/TranscribeTab';
import { EditorTab } from './tabs/editor/EditorTab';
import { ExportTab } from './tabs/export/ExportTab';
import { LibraryTab } from './tabs/library/LibraryTab';
import { SettingsTab } from './tabs/settings/SettingsTab';
import { useMeta } from './state/useMeta';
import { useMode } from './state/useMode';
import { useJob } from './state/useJob';
import { useLibrary } from './state/useLibrary';
import { useModels } from './state/useModels';
import { useSetup } from './state/useSetup';
import { useHealth } from './state/useHealth';
import { SetupScreen } from './components/setup/SetupScreen';
import { makeT, useI18n, useT } from './i18n';
import { UpdateBanner } from './components/update/UpdateBanner';
import { HealthBanner } from './components/health/HealthBanner';

// Re-run the environment health-check on this cadence so a model/dep that
// goes missing mid-session (deleted, or a half-finished setup) surfaces
// without a manual reload.
const HEALTH_RECHECK_MS = 60_000;

const COLLAPSE_WIDTH = 900;

export default function App() {
  const t = useT();
  const [tab, setTab] = useState<TabKey>('transcribe');
  const [collapsed, setCollapsed] = useState(false);

  // Each product mode surfaces only a subset of the 5 tabs (tabsForMode). If
  // the mode changes while we're on a tab it no longer shows — e.g. switching
  // to Clean-Text while sitting on the lyric Editor — snap back to its flow
  // (辨識) instead of leaving the router pointed at a hidden/irrelevant tab.
  const mode = useMode((s) => s.mode);
  useEffect(() => {
    if (!tabsForMode(mode).includes(tab)) setTab('transcribe');
  }, [mode, tab]);

  // First-run setup gate — only active inside Tauri when venv is absent.
  const inTauri = useSetup((s) => s.inTauri);
  const needsSetup = useSetup((s) => s.needsSetup);
  const checkStatus = useSetup((s) => s.checkStatus);

  useEffect(() => {
    if (inTauri) void checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTauri]);

  const loadMeta = useMeta((s) => s.load);
  const loadModels = useModels((s) => s.load);
  const disposeModels = useModels((s) => s.disposeAll);
  const refreshHealth = useHealth((s) => s.refresh);
  const online = useMeta((s) => s.online);
  const bootFailed = useMeta((s) => s.bootFailed);
  const forceReinstall = useSetup((s) => s.forceReinstall);
  // Bumped by the "retry" affordance to re-arm the reconnect loop after a timeout.
  const [reconnectNonce, setReconnectNonce] = useState(0);

  // Tear down any in-flight model-download polling timers on unmount.
  useEffect(() => () => disposeModels(), [disposeModels]);

  // Environment health-check: only meaningful AFTER first-run setup (when a
  // venv exists). Refresh once we're past the SetupScreen gate, then poll on
  // an interval so a piece deleted mid-session re-surfaces the HealthBanner.
  // (The SetupScreen handles the no-venv first-run; HealthBanner is for after.)
  const pastSetup = !(inTauri && needsSetup);
  useEffect(() => {
    // Only health-check once the engine is actually up — otherwise /api/health
    // fails during the boot window and the HealthBanner would flash alarms.
    if (!pastSetup || !online) return;
    void refreshHealth();
    const id = window.setInterval(() => void refreshHealth(), HEALTH_RECHECK_MS);
    return () => window.clearInterval(id);
  }, [pastSetup, online, refreshHealth]);

  // Reconnect loop — the heart of the calm-boot UX. The engine needs ~20-30s to
  // bind 127.0.0.1:8756 (it imports torch/whisper at startup), so a single load
  // on launch fails and would leave the app stuck OFFLINE forever. This polls
  // /api/meta until the engine answers, covering BOTH a normal launch AND the
  // moment first-run setup completes (pastSetup flips true). While polling it
  // marks `connecting` (UI shows "starting engine…" not "OFFLINE"); if the engine
  // never answers within the deadline it marks `bootFailed` so a repair
  // affordance can appear (the broken/incomplete-venv recovery path).
  useEffect(() => {
    if (!pastSetup) return; // during the first-run wizard the engine isn't up yet by design
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 60_000;
    const m = useMeta.getState();
    if (!m.online) {
      m.setConnecting(true);
      m.setBootFailed(false);
    }
    const poll = async () => {
      if (cancelled) return;
      await loadMeta();
      await loadModels();
      if (cancelled) return;
      const s = useMeta.getState();
      if (s.online) {
        s.setConnecting(false);
        return;
      }
      if (Date.now() >= deadline) {
        s.setConnecting(false);
        s.setBootFailed(true);
        return;
      }
      timer = setTimeout(poll, 1_500);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pastSetup, loadMeta, loadModels, reconnectNonce]);

  // Collapse the rail on narrow windows.
  useEffect(() => {
    const onResize = () => setCollapsed(window.innerWidth < COLLAPSE_WIDTH);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // When a job finishes, append it to the local library once.
  const jobStatus = useJob((s) => s.status);
  const jobResult = useJob((s) => s.result);
  const jobId = useJob((s) => s.jobId);
  const audioFile = useJob((s) => s.audioFile);
  const addRun = useLibrary((s) => s.add);
  useEffect(() => {
    if (jobStatus === 'done' && jobResult) {
      // Read the active language non-reactively (this runs in an effect, not
      // render) so the persisted run title matches the current UI language.
      const t = makeT(useI18n.getState().lang);
      const title = audioFile?.name.replace(/\.[^.]+$/, '') ?? t('common.untitledRun');
      addRun({
        id: jobId ?? `local-${Date.now()}`,
        title,
        mode: jobResult.modeUsed,
        language: jobResult.language,
        modelSize: jobResult.meta.modelSize,
        engine: jobResult.meta.engine,
        durationSec: jobResult.meta.durationSec,
        createdAt: Date.now(),
        result: jobResult,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus, jobResult, jobId]);

  // Show the first-run setup wizard as a full-screen overlay inside the
  // AppFrame (so the titlebar + window controls are always accessible).
  // In plain-browser / vite-dev mode, inTauri is false so this never fires.
  if (inTauri && needsSetup) {
    return (
      <AppFrame>
        <SetupScreen />
      </AppFrame>
    );
  }

  return (
    <AppFrame>
      {/* Update banner sits above the shell row so it spans the full width
          between the titlebar and the content area. Only renders in Tauri
          when an update is found (or during download / on error). */}
      <UpdateBanner />
      {/* Boot-failed recovery: the engine exists on disk but never answered
          within the reconnect deadline (a broken/incomplete venv, or a stuck
          process). Offer a calm retry + a repair that re-runs setup. */}
      {bootFailed && !online && (
        <div className="al-bootfail" role="alert">
          <span className="al-bootfail__msg">{t('common.boot.failed')}</span>
          <div className="al-bootfail__actions">
            <button
              type="button"
              className="al-bootfail__btn"
              onClick={() => {
                useMeta.getState().setBootFailed(false);
                setReconnectNonce((n) => n + 1);
              }}
            >
              {t('common.boot.retry')}
            </button>
            {inTauri && (
              <button
                type="button"
                className="al-bootfail__btn al-bootfail__btn--primary"
                onClick={() => forceReinstall()}
              >
                {t('common.boot.repair')}
              </button>
            )}
          </div>
        </div>
      )}
      {/* Health banner: warns + self-heals when a dep/model is missing AFTER
          first-run setup. Gated on `online` so it never flashes during boot. */}
      {online && <HealthBanner />}
      <div className="al-shell">
        <TabRail active={tab} onChange={setTab} collapsed={collapsed} />
        <div className="al-main">
          <StatusStrip activeTab={tab} />
          <div className="al-viewport">
            {tab === 'transcribe' && <TranscribeTab onOpenEditor={() => setTab('editor')} />}
            {tab === 'editor' && <EditorTab />}
            {tab === 'export' && <ExportTab />}
            {tab === 'library' && <LibraryTab onNavigate={setTab} />}
            {tab === 'settings' && <SettingsTab />}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
