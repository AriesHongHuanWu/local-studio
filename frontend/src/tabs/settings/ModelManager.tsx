/* ──────────────────────────────────────────────────────────────────
   ModelManager — real, backend-wired version.

   Groups models by kind (Whisper / Demucs / Aligner). Each row:
     • label, description, sizeMB hint, installed badge or download button
     • inline gold progress bar + message while downloading
     • trash icon when installed (guarded for required models)
     • recommended star

   Footer: disk used + cache dir + GPU VRAM total.
   Full keyboard accessibility; aria-live on progress regions.
   ────────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import {
  CheckCircle2,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge, Button, IconButton, ProgressBar } from '../../components/primitives';
import { useModels } from '../../state/useModels';
import type { ModelInfo, ModelKind } from '../../api/types';

// ── section labels ──────────────────────────────────────────────────────────
const KIND_LABEL: Record<ModelKind, { zh: string; en: string }> = {
  whisper: { zh: '辨識模型', en: 'Whisper' },
  demucs: { zh: '人聲分離', en: 'Demucs' },
  aligner: { zh: '強制對齊', en: 'Aligner' },
};

const KIND_ORDER: ModelKind[] = ['whisper', 'demucs', 'aligner'];

// ── single model row ─────────────────────────────────────────────────────────
function ModelRow({ model }: { model: ModelInfo }) {
  const perId = useModels((s) => s.perId);
  const downloadAndTrack = useModels((s) => s.downloadAndTrack);
  const remove = useModels((s) => s.remove);

  const progress = perId[model.id];
  const isDownloading = progress?.status === 'running';
  const isError = progress?.status === 'error';
  const pct = progress?.pct ?? 0;
  const message = progress?.message ?? '';

  const handleDownload = () => void downloadAndTrack(model.id);

  const handleRemove = () => {
    if (model.required) {
      const ok = window.confirm(
        `「${model.label}」是必要元件。移除後對應功能將無法使用，確定繼續？\n` +
          `"${model.label}" is required for some features. Remove anyway?`,
      );
      if (!ok) return;
    }
    void remove(model.id);
  };

  return (
    <div
      className={[
        'al-modelrow',
        isDownloading ? 'al-modelrow--busy' : '',
        isError ? 'al-modelrow--error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── body ── */}
      <div className="al-modelrow__body">
        <div className="al-modelrow__name">
          {model.label}
          {model.recommended && (
            <span className="al-modelrow__rec" title="建議下載 Recommended">
              <Star size={9} strokeWidth={2.5} style={{ display: 'inline', marginRight: 2 }} />
              建議
            </span>
          )}
          {model.required && (
            <span
              className="al-modelrow__req"
              title="必要元件 Required for this feature"
            >
              必要
            </span>
          )}
        </div>
        <div className="al-modelrow__desc">{model.description}</div>
        <div className="al-modelrow__meta">
          {(model.sizeMB / 1024).toFixed(1)} GB 下載 download ·{' '}
          {model.vramHint}
          {model.sizeOnDiskMB > 0 && (
            <>
              {' '}· 磁碟 disk {(model.sizeOnDiskMB / 1024).toFixed(1)} GB
            </>
          )}
        </div>

        {/* progress bar — aria-live so screen readers announce updates */}
        {isDownloading && (
          <div
            className="al-modelrow__prog"
            aria-live="polite"
            aria-label={`下載進度 ${Math.round(pct)}%`}
          >
            <ProgressBar value={pct} tone="gold" />
            <span className="al-modelrow__pct">
              {Math.round(pct)}% · {message}
            </span>
          </div>
        )}
        {isError && (
          <div className="al-modelrow__errmsg" aria-live="assertive">
            <XCircle size={12} />
            {progress?.error ?? message}
          </div>
        )}
      </div>

      {/* ── actions ── */}
      <div className="al-modelrow__actions">
        {model.installed && !isDownloading && (
          <>
            <Badge tone="green" dot>
              已安裝
            </Badge>
            <IconButton
              label={`移除 ${model.label} Remove`}
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleRemove}
            />
          </>
        )}
        {!model.installed && !isDownloading && !isError && (
          <Button
            size="sm"
            icon={<Download size={14} />}
            onClick={handleDownload}
          >
            下載
          </Button>
        )}
        {!model.installed && isError && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} />}
            onClick={handleDownload}
          >
            重試
          </Button>
        )}
        {isDownloading && (
          <span className="al-modelrow__spinner" aria-hidden="true">
            <Loader2 size={15} className="al-spin" />
          </span>
        )}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export function ModelManager() {
  const models = useModels((s) => s.models);
  const diskUsedMB = useModels((s) => s.diskUsedMB);
  const cacheDir = useModels((s) => s.cacheDir);
  const gpuVramTotalMB = useModels((s) => s.gpuVramTotalMB);
  const loading = useModels((s) => s.loading);
  const offline = useModels((s) => s.offline);
  const load = useModels((s) => s.load);

  // Trigger initial load when component mounts (idempotent if already loaded)
  useEffect(() => {
    if (models.length === 0) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (offline && models.length === 0) {
    return (
      <div className="al-panel al-models al-models--offline">
        <span className="al-models__offlinemsg">
          後端離線 — 啟動伺服器後重整。Backend offline — start the server and refresh.
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={13} />}
          onClick={() => void load()}
        >
          重試 Retry
        </Button>
      </div>
    );
  }

  if (loading && models.length === 0) {
    return (
      <div className="al-panel al-models al-models--loading">
        <Loader2 size={16} className="al-spin" />
        <span>讀取模型清單… Loading model list…</span>
      </div>
    );
  }

  // Group by kind in display order
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    rows: models.filter((m) => m.kind === kind),
  })).filter((g) => g.rows.length > 0);

  const diskGb = (diskUsedMB / 1024).toFixed(1);
  const vramGb = gpuVramTotalMB != null ? (gpuVramTotalMB / 1024).toFixed(0) : null;

  return (
    <div className="al-panel al-models">
      {grouped.map(({ kind, rows }) => (
        <div key={kind} className="al-models__group">
          <div className="al-models__grouplabel">
            <span className="al-models__groupzh">{KIND_LABEL[kind].zh}</span>
            <span className="al-models__groupen">{KIND_LABEL[kind].en}</span>
          </div>
          {rows.map((m) => (
            <ModelRow key={m.id} model={m} />
          ))}
        </div>
      ))}

      {/* ── footer ── */}
      <div className="al-models__foot">
        <span className="al-models__disk">
          <HardDrive size={12} className="al-models__diskicon" />
          磁碟用量 Disk used:{' '}
          <strong>{diskGb} GB</strong>
        </span>
        <span className="al-models__cache" title={cacheDir}>
          {cacheDir.length > 44 ? '…' + cacheDir.slice(-42) : cacheDir}
        </span>
        {vramGb && (
          <span className="al-models__vram">
            <CheckCircle2 size={11} className="al-models__vramicon" />
            GPU {vramGb} GB VRAM
          </span>
        )}
        <button
          type="button"
          className="al-models__refresh"
          onClick={() => void load()}
          title="重新整理模型列表 Refresh model list"
          aria-label="重新整理模型列表"
        >
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  );
}
