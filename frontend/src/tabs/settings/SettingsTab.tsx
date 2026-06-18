import './settings.css';
import { FolderLock, Cpu, Layers3, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button, Eyebrow } from '../../components/primitives';
import { GpuReadout } from './GpuReadout';
import { ModelManager } from './ModelManager';
import { ModelSizePicker } from './ModelSizePicker';
import { EnginePicker } from './EnginePicker';
import { DevicePicker } from './DevicePicker';
import { DefaultsPanel } from './DefaultsPanel';
import type { DefaultsValue } from './DefaultsPanel';
import type { ModelStatus } from './modelStatus';
import { useMeta } from '../../state/useMeta';
import { useModels } from '../../state/useModels';
import { useSettings } from '../../state/useSettings';
import type { Device, Engine } from '../../api/types';

export function SettingsTab() {
  const meta = useMeta((s) => s.meta);
  const online = useMeta((s) => s.online);
  const defaults = useSettings((s) => s.defaults);
  const setDefaults = useSettings((s) => s.set);
  const resetDefaults = useSettings((s) => s.reset);

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
        <h1 className="al-tabpage__title">設定 · Settings</h1>
        <p className="al-tabpage__lede">
          本機控制室 — 引擎、硬體、模型管理、預設值。一切都留在這台機器上。
          The local-first control room — engine, hardware, model manager, defaults.
        </p>
      </div>

      <div className="al-settings">
        {/* ── HARDWARE ── */}
        <section className="al-settings__group">
          <Eyebrow num={1}>Hardware · 硬體</Eyebrow>
          <GpuReadout online={online} gpu={meta.gpu} />
        </section>

        {/* ── ENGINE / DEVICE ── */}
        <section className="al-settings__group">
          <Eyebrow num={2}>Engine &amp; Device · 引擎與裝置</Eyebrow>
          <div className="al-settings__pair">
            <div className="al-settings__field">
              <label className="al-settings__caption">
                <Cpu size={13} /> 引擎 Engine
              </label>
              <EnginePicker
                engines={meta.engines}
                value={defaults.engine}
                onChange={(engine: Engine) => setDefaults({ engine })}
              />
            </div>
            <div className="al-settings__field">
              <label className="al-settings__caption">
                <Layers3 size={13} /> 運算裝置 Device
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
          <Eyebrow num={3}>Model size · 模型大小</Eyebrow>
          <ModelSizePicker
            modelSizes={meta.modelSizes}
            value={defaults.modelSize}
            statuses={statuses}
            onChange={(size) => setDefaults({ modelSize: size })}
          />
        </section>

        {/* ── MODEL MANAGER ── */}
        <section className="al-settings__group">
          <Eyebrow num={4}>Models · 模型管理</Eyebrow>
          <ModelManager />
        </section>

        {/* ── DEFAULTS ── */}
        <section className="al-settings__group">
          <div className="al-settings__grouphead">
            <Eyebrow num={5}>Defaults · 預設值</Eyebrow>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={13} />}
              onClick={resetDefaults}
              title="還原所有預設值 Reset all defaults"
            >
              還原 Reset
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

        {/* ── LOCAL ASSURANCE ── */}
        <section className="al-settings__group">
          <Eyebrow num={6}>Privacy · 本機保證</Eyebrow>
          <div className="al-panel al-assurance">
            <div className="al-assurance__lead">
              <ShieldCheck size={16} className="al-assurance__shield" />
              <span>
                一切都在這台機器上 — 不會外傳。沒有雲端、沒有遙測。
                <br />
                Everything runs locally — no cloud, no telemetry, no account.
              </span>
            </div>
            <dl className="al-assurance__paths">
              <div className="al-assurance__path">
                <dt>
                  <FolderLock size={12} /> 資料夾 Data folder
                </dt>
                <dd>
                  <code>~/.autolyrics</code>
                </dd>
              </div>
              <div className="al-assurance__path">
                <dt>模型 Models</dt>
                <dd>
                  <code>~/.autolyrics/models</code>
                </dd>
              </div>
              <div className="al-assurance__path">
                <dt>後端 Backend</dt>
                <dd>
                  <code>http://127.0.0.1:8756</code>
                </dd>
              </div>
              <div className="al-assurance__path">
                <dt>版本 Version</dt>
                <dd>
                  <code>{meta.version}</code>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
