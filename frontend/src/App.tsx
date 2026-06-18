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
import { SetupScreen } from './components/setup/SetupScreen';

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

  // Load /api/meta and model list once at startup (fall back gracefully if offline).
  // Tear down any in-flight model-download polling timers on unmount.
  useEffect(() => {
    void loadMeta();
    void loadModels();
    return () => disposeModels();
  }, [loadMeta, loadModels, disposeModels]);

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
      const title = audioFile?.name.replace(/\.[^.]+$/, '') ?? 'Untitled run';
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
