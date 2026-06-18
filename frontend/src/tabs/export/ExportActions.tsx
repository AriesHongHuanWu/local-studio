import { useState } from 'react';
import { Copy, Check, Download, HardDriveDownload, FileCheck2 } from 'lucide-react';
import { Button, Badge } from '../../components/primitives';
import { exportEdited, exportOriginal } from '../../api/jobs';
import { renderExport, exportFilename } from '../../lib/exporters';
import type { Result } from '../../api/types';
import {
  applyEncoding,
  mimeFor,
  type ExportConfig,
} from './exportOptions';
import { hasTauri, saveText, downloadBlob } from './saveFile';

export interface ExportActionsProps {
  result: Result;
  config: ExportConfig;
  /** When dirty → POST /api/export; else GET …/export with this jobId. */
  dirty: boolean;
  jobId: string | null;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; msg: string }
  | { kind: 'fallback'; msg: string }
  | { kind: 'error'; msg: string };

/** Copy + Save-to-disk. Routes edited vs original per the API contract. */
export function ExportActions({ result, config, dirty, jobId }: ExportActionsProps) {
  const { fmt, level, precisionMs, encoding } = config;
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const edited = dirty || !jobId;
  const filename = exportFilename(fmt, level);

  /** The client-side text, with the chosen encoding's BOM applied. */
  const localText = () =>
    applyEncoding(renderExport(result, fmt, { level, precisionMs }), encoding);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        renderExport(result, fmt, { level, precisionMs }),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setStatus({ kind: 'error', msg: '複製失敗 Copy failed' });
    }
  };

  const save = async () => {
    setStatus({ kind: 'saving' });
    try {
      // Authoritative bytes come from the backend.
      const blob = edited
        ? await exportEdited(result, fmt, level)
        : await exportOriginal(jobId as string, fmt, level);

      // Tauri path: read the blob text so we can write via the native fs.
      if (hasTauri()) {
        const text = applyEncoding(await blob.text(), encoding);
        const outcome = await saveText(text, filename, fmt, mimeFor(fmt));
        if (outcome.kind === 'cancelled') {
          setStatus({ kind: 'idle' });
        } else if (outcome.kind === 'tauri') {
          setStatus({ kind: 'saved', msg: `已存到 ${outcome.path}` });
        } else {
          setStatus({ kind: 'saved', msg: `已下載 ${filename}` });
        }
      } else {
        downloadBlob(
          encoding === 'utf-8-bom'
            ? new Blob([applyEncoding(await blob.text(), encoding)], {
                type: mimeFor(fmt),
              })
            : blob,
          filename,
        );
        setStatus({ kind: 'saved', msg: `已下載 ${filename}` });
      }
    } catch {
      // Offline fallback: render client-side and save that — never blocks.
      try {
        const outcome = await saveText(localText(), filename, fmt, mimeFor(fmt));
        if (outcome.kind === 'cancelled') {
          setStatus({ kind: 'idle' });
        } else {
          setStatus({
            kind: 'fallback',
            msg: '後端離線 — 已用本機預覽輸出 Saved local preview (backend offline)',
          });
        }
      } catch {
        setStatus({ kind: 'error', msg: '存檔失敗 Save failed' });
      }
    }
  };

  const saving = status.kind === 'saving';

  return (
    <div className="al-export__actions">
      <div className="al-export__buttons">
        <Button
          variant="default"
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          onClick={copy}
        >
          {copied ? '已複製 Copied' : '複製 Copy'}
        </Button>
        <Button
          variant="primary"
          icon={
            saving ? (
              <Download size={16} className="al-spin" />
            ) : hasTauri() ? (
              <HardDriveDownload size={16} />
            ) : (
              <Download size={16} />
            )
          }
          onClick={save}
          disabled={saving}
        >
          {saving ? '輸出中… Saving' : '存到磁碟 · Save'}
        </Button>
      </div>

      <div className="al-export__meta">
        <span className="al-export__routing" title="匯出路由 Export routing">
          {edited
            ? 'POST /api/export · edited'
            : `GET /api/jobs/${jobId}/export · original`}
        </span>

        {/* Visible outcome badges + polite live region for saved/fallback. */}
        <span className="al-export__status" role="status" aria-live="polite" aria-atomic="true">
          {status.kind === 'saved' && (
            <Badge tone="green" dot>
              <FileCheck2 size={12} /> {status.msg}
            </Badge>
          )}
          {status.kind === 'fallback' && (
            <Badge tone="amber" dot>
              {status.msg}
            </Badge>
          )}
        </span>

        {/* Assertive announcement for failures. */}
        <span role="alert" aria-live="assertive" aria-atomic="true">
          {status.kind === 'error' && (
            <Badge tone="error" dot>
              {status.msg}
            </Badge>
          )}
        </span>

        {/* SR-only: the Copy button's visual label change isn't announced. */}
        <span className="al-vh" role="status" aria-live="polite" aria-atomic="true">
          {copied ? '已複製到剪貼簿 Copied to clipboard' : ''}
        </span>
      </div>
    </div>
  );
}
