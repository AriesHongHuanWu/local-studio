import { useEffect, useRef, useState } from 'react';
import { AppFrame } from './components/shell/AppFrame';
import { TabRail } from './components/shell/TabRail';
import { StatusStrip } from './components/shell/StatusStrip';
import type { TabKey } from './components/shell/tabs';
import { TranscribeTab } from './tabs/transcribe/TranscribeTab';
import { EditorTab } from './tabs/editor/EditorTab';
import { ExportTab } from './tabs/export/ExportTab';
import { LibraryTab } from './tabs/library/LibraryTab';
import { SettingsTab } from './tabs/settings/SettingsTab';
import { useMeta } from './state/useMeta';
import { useJob } from './state/useJob';
import { useLibrary } from './state/useLibrary';
import { useModels } from './state/useModels';
import { useSetup } from './state/useSetup';
import { useHealth } from './state/useHealth';
import { SetupScreen } from './components/setup/SetupScreen';
import { makeT, useI18n } from './i18n';
import { UpdateBanner } from './components/update/UpdateBanner';
import { HealthBanner } from './components/health/HealthBanner';

// Re-run the environment health-check on this cadence so a model/dep that
// goes missing mid-session (deleted, or a half-finished setup) surfaces
// without a manual reload.
const HEALTH_RECHECK_MS = 60_000;

const COLLAPSE_WIDTH = 900;

export default function App() {
  const [tab, setTab] = useState<TabKey>('transcribe');
  const [collapsed, setCollapsed] = useState(false);

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

  // Load /api/meta and model list once at startup (fall back gracefully if offline).
  // Tear down any in-flight model-download polling timers on unmount.
  useEffect(() => {
    void loadMeta();
    void loadModels();
    return () => disposeModels();
  }, [loadMeta, loadModels, disposeModels]);

  // Environment health-check: only meaningful AFTER first-run setup (when a
  // venv exists). Refresh once we're past the SetupScreen gate, then poll on
  // an interval so a piece deleted mid-session re-surfaces the HealthBanner.
  // (The SetupScreen handles the no-venv first-run; HealthBanner is for after.)
  const pastSetup = !(inTauri && needsSetup);
  useEffect(() => {
    if (!pastSetup) return;
    void refreshHealth();
    const id = window.setInterval(() => void refreshHealth(), HEALTH_RECHECK_MS);
    return () => window.clearInterval(id);
  }, [pastSetup, refreshHealth]);

  // After first-run setup finishes (needsSetup true→false), the Rust shell spawns
  // uvicorn, which needs several seconds to bind 127.0.0.1:8756 (torch/whisper
  // import time). The startup load above already failed (no venv yet), so without
  // an active re-poll the app stays stuck OFFLINE and the model picker never
  // appears. Watch the transition and poll meta+models until online (~30s cap).
  const prevNeedsSetup = useRef(needsSetup);
  useEffect(() => {
    const was = prevNeedsSetup.current;
    prevNeedsSetup.current = needsSetup;
    // Only act on a real true→false transition (setup just completed).
    if (!(was && !needsSetup)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 30_000;

    const poll = async () => {
      if (cancelled) return;
      await loadMeta();
      await loadModels();
      if (cancelled) return;
      if (useMeta.getState().online || Date.now() >= deadline) return;
      timer = setTimeout(poll, 1_500);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [needsSetup, loadMeta, loadModels]);

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
      {/* Health banner: warns + self-heals when a dep/model is missing AFTER
          first-run setup. Self-hides when everything required is present. */}
      <HealthBanner />
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
