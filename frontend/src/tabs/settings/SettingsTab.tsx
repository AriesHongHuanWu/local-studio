import './settings.css';
import { FolderLock, Cpu, Layers3, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button, Eyebrow } from '../../components/primitives';
import { GpuReadout } from './GpuReadout';
import { ModelManager } from './ModelManager';
import { StoragePanel } from './StoragePanel';
import { DataLocationPanel } from './DataLocationPanel';
import { ModelSizePicker } from './ModelSizePicker';
import { EnginePicker } from './EnginePicker';
import { DevicePicker } from './DevicePicker';
import { DefaultsPanel } from './DefaultsPanel';
import type { DefaultsValue } from './DefaultsPanel';
import type { ModelStatus } from './modelStatus';
import { useMeta } from '../../state/useMeta';
import { useModels } from '../../state/useModels';
import { useSettings } from '../../state/useSettings';
import { useDataRoot } from '../../state/useDataRoot';
import { useAppVersion } from '../../state/useAppVersion';
import type { Device, Engine } from '../../api/types';
import { useT } from '../../i18n';
import { UpdateSettingsRow } from '../../components/update/UpdateSettingsRow';

export function SettingsTab() {
  const t = useT();
  const meta = useMeta((s) => s.meta);
  const online = useMeta((s) => s.online);
  const defaults = useSettings((s) => s.defaults);
  const setDefaults = useSettings((s) => s.set);
  const resetDefaults = useSettings((s) => s.reset);
  // Real on-disk data root (desktop). null in browser / before first load.
  const dataInfo = useDataRoot((s) => s.info);
  const dataPath = dataInfo?.effective ?? '~/.local · %LOCALAPPDATA%';
  const appVersion = useAppVersion();

  // Derive install state from the real useModels store for the size picker.
  const modelInfos = useModels((s) => s.models);
  const statuses: ModelStatus[] = modelInfos
    .filter((m) => m.kind === 'whisper' && m.whisperSize != null)
    .map((m) => ({
      size: m.whisperSize as import('../../api/types').ModelSize,
      state: m.installed ? 'installed' : 'absent',
      pct: 100,
    }));

  const defaultsValue: DefaultsValue = {
    modelSize: defaults.modelSize,
    language: defaults.language,
    mode: defaults.mode,
    exportFormat: defaults.exportFormat,
    separate: defaults.separate,
  };

  return (
    <div className="al-tabpage">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{t('settings.title')}</h1>
        <p className="al-tabpage__lede">{t('settings.lede')}</p>
      </div>

      <div className="al-settings">
        {/* ── HARDWARE ── */}
        <section className="al-settings__group">
          <Eyebrow num={1}>{t('settings.hardware')}</Eyebrow>
          <GpuReadout online={online} gpu={meta.gpu} />
        </section>

        {/* ── ENGINE / DEVICE ── */}
        <section className="al-settings__group">
          <Eyebrow num={2}>{t('settings.engineDevice')}</Eyebrow>
          <div className="al-settings__pair">
            <div className="al-settings__field">
              <label className="al-settings__caption">
                <Cpu size={13} /> {t('settings.captionEngine')}
              </label>
              <EnginePicker
                engines={meta.engines}
                value={defaults.engine}
                onChange={(engine: Engine) => setDefaults({ engine })}
              />
            </div>
            <div className="al-settings__field">
              <label className="al-settings__caption">
                <Layers3 size={13} /> {t('settings.captionDevice')}
              </label>
              <DevicePicker
                value={defaults.device}
                gpuAvailable={meta.gpu}
                onChange={(device: Device) => setDefaults({ device })}
              />
            </div>
          </div>
        </section>

        {/* ── MODEL SIZE ── */}
        <section className="al-settings__group">
          <Eyebrow num={3}>{t('settings.modelSize')}</Eyebrow>
          <ModelSizePicker
            modelSizes={meta.modelSizes}
            value={defaults.modelSize}
            statuses={statuses}
            onChange={(size) => setDefaults({ modelSize: size })}
          />
        </section>

        {/* ── MODEL MANAGER ── */}
        <section className="al-settings__group">
          <Eyebrow num={4}>{t('settings.models')}</Eyebrow>
          <ModelManager />
        </section>

        {/* ── DEFAULTS ── */}
        <section className="al-settings__group">
          <div className="al-settings__grouphead">
            <Eyebrow num={5}>{t('settings.defaults')}</Eyebrow>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={13} />}
              onClick={resetDefaults}
              title={t('settings.resetTitle')}
            >
              {t('settings.resetAll')}
            </Button>
          </div>
          <DefaultsPanel
            value={defaultsValue}
            languages={meta.languages}
            modelSizes={meta.modelSizes}
            demucsAvailable={meta.demucs}
            alignerAvailable={meta.aligner}
            onChange={(patch) => setDefaults(patch)}
          />
        </section>

        {/* ── APP UPDATE ── */}
        <section className="al-settings__group">
          <Eyebrow num={6}>{t('update.settingsEyebrow')}</Eyebrow>
          <UpdateSettingsRow />
        </section>

        {/* ── DATA LOCATION (which drive) ── */}
        <section className="al-settings__group">
          <Eyebrow num={7}>{t('settings.dataLocation')}</Eyebrow>
          <DataLocationPanel />
        </section>

        {/* ── STORAGE ── */}
        <section className="al-settings__group">
          <div className="al-settings__grouphead">
            <Eyebrow num={8}>{t('storage.title')}</Eyebrow>
          </div>
          <p className="al-settings__caption" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {t('storage.lede')}
          </p>
          <StoragePanel />
        </section>

        {/* ── LOCAL ASSURANCE ── */}
        <section className="al-settings__group">
          <Eyebrow num={9}>{t('settings.privacy')}</Eyebrow>
          <div className="al-panel al-assurance">
            <div className="al-assurance__lead">
              <ShieldCheck size={16} className="al-assurance__shield" />
              <span>{t('settings.assuranceLead')}</span>
            </div>
            <dl className="al-assurance__paths">
              <div className="al-assurance__path">
                <dt>
                  <FolderLock size={12} /> {t('settings.pathData')}
                </dt>
                <dd>
                  <code>{dataPath}</code>
                </dd>
              </div>
              <div className="al-assurance__path">
                <dt>{t('settings.pathBackend')}</dt>
                <dd>
                  <code>http://127.0.0.1:8756</code>
                </dd>
              </div>
              <div className="al-assurance__path">
                <dt>{t('settings.pathVersion')}</dt>
                <dd>
                  <code>{appVersion ?? meta.version}</code>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
