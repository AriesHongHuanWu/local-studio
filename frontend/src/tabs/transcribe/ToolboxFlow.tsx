/* ──────────────────────────────────────────────────────────────────
   ToolboxFlow — the Audio Toolbox (音訊工具箱) surface. A grid of small
   tools (declared by the backend) grouped by category; pick one, drop a
   file, set params, run. Analyze tools show a result; process tools save
   the processed audio. Self-contained, mirroring the other mode surfaces.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import {
  Mic, Activity, Music2, Gauge, Zap, Wind, Scissors, TrendingUp, Move,
  Crosshair, FileAudio, UploadCloud, Loader2, Play, Wrench, Download,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { listTools, runTool, type ToolDef } from '../../api/tools';
import { saveBinaryBlob } from '../export/saveFile';
import { ApiError } from '../../api/client';
import { useLang, useT } from '../../i18n';
import './toolbox.css';

const ICONS: Record<string, LucideIcon> = {
  Mic, Activity, Music2, Gauge, Zap, Wind, Scissors, TrendingUp, Move, Crosshair, FileAudio, Download,
};
const CAT_ORDER = ['vocal', 'analyze', 'loudness', 'repair', 'edit', 'stereo', 'export'];

export function ToolboxFlow() {
  const t = useT();
  const lang = useLang();
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [sel, setSel] = useState<ToolDef | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    listTools(ac.signal)
      .then(({ tools: ts, fetchAvailable }) => setTools(fetchAvailable ? ts : ts.filter((x) => x.kind !== 'fetch')))
      .catch(() => { /* offline — empty grid */ });
    return () => ac.abort();
  }, []);

  const pick = (tool: ToolDef) => {
    setSel(tool);
    setResult(null);
    setMsg(null);
    setErr(null);
    const p: Record<string, unknown> = {};
    tool.params.forEach((pr) => { p[pr.key] = pr.default; });
    setParams(p);
  };

  const run = useCallback(async () => {
    if (!sel || !file) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    setMsg(null);
    try {
      const r = await runTool(sel.id, file, params);
      if (r.kind === 'analyze') {
        setResult(r.result);
      } else {
        const ext = r.filename.split('.').pop() || 'wav';
        const out = await saveBinaryBlob(r.blob, r.filename, { name: 'Audio', extensions: [ext] });
        setMsg(out.kind === 'cancelled' ? null : t('tools.saved'));
      }
    } catch (e) {
      setErr(e instanceof ApiError && e.offline ? t('tools.err.offline')
        : e instanceof Error ? e.message : t('tools.err.run'));
    } finally {
      setRunning(false);
    }
  }, [sel, file, params, t]);

  const label = (tool: ToolDef) => (lang === 'en' ? tool.labelEn : tool.label);
  const desc = (tool: ToolDef) => (lang === 'en' ? tool.descEn : tool.desc);

  const byCat = new Map<string, ToolDef[]>();
  for (const tool of tools) {
    const arr = byCat.get(tool.category) ?? [];
    arr.push(tool);
    byCat.set(tool.category, arr);
  }
  const cats = [...byCat.keys()].sort((a, b) => CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b));

  return (
    <div className="al-tabpage al-toolbox">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{t('tools.title')}</h1>
        <p className="al-tabpage__lede">{t('tools.lede')}</p>
      </div>

      {tools.length === 0 && <p className="al-toolbox__empty">{t('tools.empty')}</p>}

      {/* File first: drop/choose the audio at the TOP, then pick a tool below. */}
      {tools.length > 0 && (
        <label className="al-master__drop al-toolbox__drop">
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.m4a,.aac,.ogg"
            className="al-master__file"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setMsg(null); }}
          />
          <UploadCloud size={22} />
          <span className="al-master__dropmain">{file ? file.name : t('tools.drop')}</span>
          <span className="al-master__drophint">WAV · MP3 · FLAC · M4A</span>
        </label>
      )}

      {/* Active tool's controls sit right under the file drop (top); the tool
          switcher grid is below it. */}
      {sel && (
        <section className="al-section al-toolrun">
          <p className="al-toolrun__title">{label(sel)}</p>

          {!file && <p className="al-toolrun__hint">⬆ {t('tools.drop')}</p>}

          {sel.params.length > 0 && (
            <div className="al-toolrun__params">
              {sel.params.map((pr) => (
                <label key={pr.key} className="al-toolrun__param">
                  <span>{pr.label}</span>
                  {pr.type === 'select' ? (
                    <select
                      value={String(params[pr.key] ?? pr.default ?? '')}
                      disabled={running}
                      onChange={(e) => {
                        const opt = pr.options?.find((o) => String(o.value) === e.target.value);
                        setParams((p) => ({ ...p, [pr.key]: opt ? opt.value : e.target.value }));
                      }}
                    >
                      {pr.options?.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min={pr.min}
                      max={pr.max}
                      step={pr.step}
                      value={Number(params[pr.key] ?? pr.default ?? 0)}
                      disabled={running}
                      onChange={(e) => setParams((p) => ({ ...p, [pr.key]: Number(e.target.value) }))}
                    />
                  )}
                </label>
              ))}
            </div>
          )}

          <button type="button" className="al-btn al-btn--primary al-btn--lg al-toolrun__go"
            disabled={running || !file} onClick={run}>
            {running ? <Loader2 size={18} className="al-spin" /> : <Play size={18} />}
            {sel.kind === 'analyze' ? t('tools.analyze') : t('tools.run')}
          </button>

          {err && <p className="al-toolrun__err">{err}</p>}
          {msg && <p className="al-toolrun__msg">{msg}</p>}
          {result && <ResultView result={result} />}
        </section>
      )}

      {cats.map((cat) => (
        <section key={cat} className="al-section">
          <p className="al-toolbox__cat">{t(`tools.cat.${cat}`)}</p>
          <div className="al-toolbox__grid">
            {byCat.get(cat)!.map((tool) => {
              const Icon = ICONS[tool.icon] ?? Wrench;
              return (
                <button
                  key={tool.id}
                  type="button"
                  className={`al-toolcard${sel?.id === tool.id ? ' al-toolcard--active' : ''}`}
                  onClick={() => pick(tool)}
                >
                  <span className="al-toolcard__icon"><Icon size={18} /></span>
                  <span className="al-toolcard__name">{label(tool)}</span>
                  <span className="al-toolcard__desc">{desc(tool)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Render an analyze result as a readable nested key/value list. */
function ResultView({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="al-toolresult">
      {Object.entries(result).map(([k, v]) => (
        <div key={k} className="al-toolresult__row">
          <span className="al-toolresult__k">{k}</span>
          <span className="al-toolresult__v">{fmtVal(v)}</span>
        </div>
      ))}
    </div>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => fmtVal(x)).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${fmtVal(x)}`)
      .join(' · ');
  }
  return String(v);
}
