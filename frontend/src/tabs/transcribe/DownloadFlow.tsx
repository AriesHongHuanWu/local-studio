/* ──────────────────────────────────────────────────────────────────
   DownloadFlow — the standalone Downloader + Song Analyzer mode.

   Paste a URL (YouTube + 1000s of sites) → probe formats → pick audio
   (WAV/FLAC/MP3/OGG) or video (progressive; unsupported high-res shown
   greyed) → download. Then: drag the file straight into a DAW, reveal it
   in the folder, hand it off to the subtitle/lyrics flows, or run the
   deep analysis (key / BPM / structure / EQ / vocal-mix advice). Keeps a
   persistent download history. Self-contained, like the other surfaces.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import {
  DownloadCloud, Loader2, FolderOpen, Move, Music, Film, Sparkles,
  Clapperboard, Mic2, Trash2, Link2, AlertTriangle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useMode } from '../../state/useMode';
import { usePendingMedia } from '../../state/usePendingMedia';
import { useDownloadHistory } from '../../state/useDownloadHistory';
import { useLang, useT } from '../../i18n';
import { ApiError } from '../../api/client';
import {
  downloadStatus, probeUrl, fetchMedia, analyzeSong,
  type ProbeResult, type SongAnalysis,
} from '../../api/download';
import { hasTauri, saveBlobToDownloads, saveBinaryBlob, revealPath, dragOutPath } from '../export/saveFile';
import { SongAnalysisPanel } from './download/SongAnalysisPanel';
import { AddToProject } from '../catalog/AddToProject';
import './download/download.css';

interface DownloadResult {
  blob: Blob;
  file: File;
  filename: string;
  ext: string;
  kind: string;
  title: string;
  path: string | null;   // disk path (Tauri) → enables drag/reveal
}

type Status = 'idle' | 'probing' | 'probed' | 'downloading' | 'done';

export function DownloadFlow() {
  const t = useT();
  const lang = useLang();
  const en = lang === 'en';
  const setMode = useMode((s) => s.setMode);
  const setPending = usePendingMedia((s) => s.setPending);
  const history = useDownloadHistory((s) => s.entries);
  const addHistory = useDownloadHistory((s) => s.add);
  const removeHistory = useDownloadHistory((s) => s.remove);
  const clearHistory = useDownloadHistory((s) => s.clear);

  const [avail, setAvail] = useState({ fetchAvailable: true, analyzeAvailable: true });
  const [url, setUrl] = useState('');
  const [rights, setRights] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [kind, setKind] = useState<'audio' | 'video'>('audio');
  const [audioFmt, setAudioFmt] = useState('wav');
  const [videoFmtId, setVideoFmtId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    downloadStatus(ac.signal).then(setAvail).catch(() => { /* keep defaults */ });
    return () => ac.abort();
  }, []);

  const doProbe = useCallback(async () => {
    if (!url.trim()) return;
    setStatus('probing'); setErr(null); setProbe(null); setResult(null); setAnalysis(null); setMsg(null);
    try {
      const p = await probeUrl(url.trim());
      setProbe(p);
      setKind('audio');
      const firstSupported = p.videoOptions.find((v) => v.supported);
      setVideoFmtId(firstSupported?.formatId ?? '');
      setStatus('probed');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('download.err.generic'));
      setStatus('idle');
    }
  }, [url, t]);

  const doDownload = useCallback(async () => {
    if (!url.trim() || !rights) return;
    setStatus('downloading'); setErr(null); setResult(null); setAnalysis(null); setMsg(null);
    try {
      const selVideo = probe?.videoOptions.find((v) => v.formatId === videoFmtId);
      const outputFormat = kind === 'audio' ? audioFmt : (selVideo?.ext ?? 'mp4');
      const r = await fetchMedia({
        url: url.trim(), kind,
        outputFormat,
        sourceFormatId: kind === 'video' ? videoFmtId : undefined,
      });
      const file = new File([r.blob], r.filename, { type: r.blob.type });
      let path: string | null = null;
      if (hasTauri()) {
        try { path = await saveBlobToDownloads(r.blob, r.filename); } catch { path = null; }
      }
      setResult({ blob: r.blob, file, filename: r.filename, ext: r.ext, kind: r.kind, title: r.title, path });
      addHistory({ url: url.trim(), title: r.title, kind: r.kind, format: r.ext,
                   filename: r.filename, path: path ?? undefined, sizeBytes: r.blob.size });
      if (path) setMsg(t('download.savedTo').replace('{path}', path));
      else if (!hasTauri()) { /* browser: keep blob; offer Save As */ }
      setStatus('done');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('download.err.generic'));
      setStatus('probed');
    }
  }, [url, rights, kind, audioFmt, videoFmtId, probe, addHistory, t]);

  const doAnalyze = useCallback(async () => {
    if (!result) return;
    setAnalyzing(true); setErr(null); setAnalysis(null);
    try {
      setAnalysis(await analyzeSong(result.file));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('download.err.generic'));
    } finally {
      setAnalyzing(false);
    }
  }, [result, t]);

  const handoff = useCallback((mode: 'video' | 'song') => {
    if (!result) return;
    setPending(result.file);
    setMode(mode);
  }, [result, setPending, setMode]);

  const onDragStart = useCallback((e: React.DragEvent, path: string | null) => {
    if (!path) return;
    e.preventDefault();
    void dragOutPath(path);
  }, []);

  // ── render ──────────────────────────────────────────────────────────
  if (!avail.fetchAvailable) {
    return (
      <div className="al-tabpage al-download">
        <div className="al-tabpage__head">
          <h1 className="al-tabpage__title">{t('download.title')}</h1>
          <p className="al-tabpage__lede">{t('download.lede')}</p>
        </div>
        <div className="al-download__notice">
          <AlertTriangle size={18} /> {t('download.engineMissing')}
        </div>
      </div>
    );
  }

  const downloading = status === 'downloading';
  const canDownload = !!url.trim() && rights && !downloading &&
    (kind === 'audio' || (kind === 'video' && !!videoFmtId));

  return (
    <div className="al-tabpage al-download">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{t('download.title')}</h1>
        <p className="al-tabpage__lede">{t('download.lede')}</p>
      </div>

      {/* ① Source URL */}
      <section className="al-section al-download__step">
        <p className="al-download__steplabel">{t('download.step.url')}</p>
        <div className="al-download__urlrow">
          <div className="al-download__inputwrap">
            <Link2 size={16} className="al-download__inputicon" />
            <input
              type="url" className="al-download__url"
              placeholder={t('download.urlPlaceholder')}
              value={url} disabled={downloading}
              onChange={(e) => { setUrl(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') doProbe(); }}
            />
          </div>
          <button type="button" className="al-btn al-btn--primary al-download__probe"
                  disabled={!url.trim() || status === 'probing' || downloading} onClick={doProbe}>
            {status === 'probing' ? <Loader2 size={16} className="al-spin" /> : <DownloadCloud size={16} />}
            {t('download.probe')}
          </button>
        </div>
      </section>

      {/* ② Choose format + download */}
      {probe && (
        <section className="al-section al-download__step al-download__pick">
          <p className="al-download__steplabel">{t('download.step.format')}</p>

          <div className="al-download__meta">
            {probe.meta.thumbnail && <img src={probe.meta.thumbnail} alt="" className="al-download__thumb" />}
            <div className="al-download__metatext">
              <div className="al-download__metatitle">{probe.meta.title}</div>
              <div className="al-download__metasub">
                {probe.meta.uploader}{probe.meta.uploader && ' · '}
                {probe.meta.extractor}
                {probe.meta.duration ? ` · ${Math.floor(probe.meta.duration / 60)}:${String(Math.round(probe.meta.duration % 60)).padStart(2, '0')}` : ''}
              </div>
            </div>
          </div>

          {/* segmented audio / video toggle */}
          <div className="al-download__seg" role="tablist">
            <button type="button" role="tab" aria-selected={kind === 'audio'}
                    className={`al-download__segbtn${kind === 'audio' ? ' is-on' : ''}`}
                    onClick={() => setKind('audio')} disabled={downloading}>
              <Music size={15} /> {t('download.typeAudio')}
            </button>
            <button type="button" role="tab" aria-selected={kind === 'video'}
                    className={`al-download__segbtn${kind === 'video' ? ' is-on' : ''}`}
                    onClick={() => setKind('video')} disabled={downloading}>
              <Film size={15} /> {t('download.typeVideo')}
            </button>
          </div>

          {kind === 'audio' ? (
            <>
              <div className="al-download__formats">
                {probe.audioOutputs.map((f) => (
                  <label key={f} className={`al-download__fmt${audioFmt === f ? ' is-on' : ''}`}>
                    <input type="radio" name="audiofmt" value={f} checked={audioFmt === f}
                           disabled={downloading} onChange={() => setAudioFmt(f)} />
                    {f.toUpperCase()}
                  </label>
                ))}
              </div>
              <p className="al-download__fmthint">{t('download.audioHint')}</p>
            </>
          ) : (
            <>
              <div className="al-download__formats al-download__formats--video">
                {probe.videoOptions.length === 0 && <span className="al-download__novideo">{t('download.videoNone')}</span>}
                {probe.videoOptions.map((v) => (
                  <label key={v.formatId}
                         className={`al-download__fmt${videoFmtId === v.formatId ? ' is-on' : ''}${v.supported ? '' : ' is-disabled'}`}
                         title={v.supported ? '' : t('download.needsMerge')}>
                    <input type="radio" name="videofmt" value={v.formatId} checked={videoFmtId === v.formatId}
                           disabled={downloading || !v.supported} onChange={() => setVideoFmtId(v.formatId)} />
                    {v.height ? `${v.height}p` : v.ext} <small>{v.ext}</small>
                    {!v.supported && <span className="al-download__unsupported">{t('download.unsupported')}</span>}
                  </label>
                ))}
              </div>
              <p className="al-download__fmthint">{t('download.videoHint')}</p>
            </>
          )}

          <label className="al-download__rights">
            <input type="checkbox" checked={rights} disabled={downloading}
                   onChange={(e) => setRights(e.target.checked)} />
            <span>{t('download.rights')}</span>
          </label>
          <button type="button" className="al-btn al-btn--primary al-btn--lg al-download__go"
                  disabled={!canDownload} onClick={doDownload}>
            {downloading ? <Loader2 size={18} className="al-spin" /> : <DownloadCloud size={18} />}
            {downloading ? t('download.downloading') : t('download.download')}
          </button>
        </section>
      )}

      {err && <p className="al-download__err">{err}</p>}
      {msg && <p className="al-download__msg">{msg}</p>}

      {/* ③ Done — file actions + what next */}
      {result && (
        <section className="al-section al-download__step al-download__result">
          <p className="al-download__steplabel">{t('download.step.done')}</p>

          <div className="al-download__resulthead">
            {result.kind === 'video' ? <Film size={18} /> : <Music size={18} />}
            <span className="al-download__resultname">{result.filename}</span>
            <span className="al-download__resultext">{result.ext.toUpperCase()}</span>
          </div>

          <div className="al-download__group">
            <span className="al-download__grouplabel">{t('download.group.file')}</span>
            <div className="al-download__actions">
              {result.path && (
                <div className="al-download__drag" draggable
                     onDragStart={(e) => onDragStart(e, result.path)}
                     title={t('download.dragHint')}>
                  <Move size={15} /> {t('download.drag')}
                </div>
              )}
              {result.path && (
                <button type="button" className="al-btn al-download__act" onClick={() => revealPath(result.path!)}>
                  <FolderOpen size={15} /> {t('download.reveal')}
                </button>
              )}
              <button type="button" className="al-btn al-download__act"
                      onClick={() => saveBinaryBlob(result.blob, result.filename, { name: 'Media', extensions: [result.ext] })}>
                <DownloadCloud size={15} /> {t('download.saveAs')}
              </button>
              <AddToProject
                defaultName={result.title}
                item={{
                  kind: 'beat', label: result.filename, path: result.path ?? undefined,
                  format: result.ext, sizeBytes: result.blob.size,
                  key: analysis?.key.name, bpm: analysis?.tempo.bpmRounded, genre: analysis?.genre.top,
                }}
              />
            </div>
          </div>

          <div className="al-download__group">
            <span className="al-download__grouplabel">{t('download.group.next')}</span>
            <div className="al-download__actions">
              <button type="button" className="al-btn al-btn--ghost al-download__act" onClick={() => handoff('video')}>
                <Clapperboard size={15} /> {t('download.toVideo')}
              </button>
              <button type="button" className="al-btn al-btn--ghost al-download__act" onClick={() => handoff('song')}>
                <Mic2 size={15} /> {t('download.toSong')}
              </button>
              {avail.analyzeAvailable && (
                <button type="button" className="al-btn al-btn--primary al-download__act"
                        disabled={analyzing} onClick={doAnalyze}>
                  {analyzing ? <Loader2 size={15} className="al-spin" /> : <Sparkles size={15} />}
                  {analyzing ? t('download.analyzing') : t('download.analyze')}
                </button>
              )}
            </div>
            <p className="al-download__handoffhint">{t('download.handoffHint')}</p>
          </div>
        </section>
      )}

      {/* analysis */}
      {analysis && (
        <section className="al-section">
          <SongAnalysisPanel analysis={analysis} media={result?.blob ?? null} />
        </section>
      )}

      {/* history (collapsible) */}
      {history.length > 0 && (
        <section className="al-section al-download__history">
          <div className="al-download__histhead">
            <button type="button" className="al-download__histtoggle" onClick={() => setHistOpen((o) => !o)}>
              {histOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              {t('download.history')} ({history.length})
            </button>
            {histOpen && <button type="button" className="al-download__clear" onClick={clearHistory}>{t('download.clearHistory')}</button>}
          </div>
          {histOpen && (
          <ul className="al-download__histlist">
            {history.map((h) => (
              <li key={h.id} className="al-download__histitem">
                <span className="al-download__histicon">{h.kind === 'video' ? <Film size={14} /> : <Music size={14} />}</span>
                <span className="al-download__histtitle2" title={h.url}>{h.title}</span>
                <span className="al-download__histmeta">{h.format.toUpperCase()} · {(h.sizeBytes / 1048576).toFixed(1)} MB</span>
                <span className="al-download__histactions">
                  {h.path && hasTauri() && (
                    <>
                      <button type="button" title={t('download.drag')}
                              className="al-download__histbtn al-download__histdrag" draggable
                              onDragStart={(e) => onDragStart(e, h.path ?? null)}>
                        <Move size={13} />
                      </button>
                      <button type="button" title={t('download.reveal')}
                              className="al-download__histbtn" onClick={() => revealPath(h.path!)}>
                        <FolderOpen size={13} />
                      </button>
                    </>
                  )}
                  <button type="button" title={t('download.remove')}
                          className="al-download__histbtn" onClick={() => removeHistory(h.id)}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          )}
        </section>
      )}

      <p className="al-download__legal">{en
        ? 'Download only content you have the right to (your own, Creative Commons, royalty-free, or licensed). No DRM/paywall bypass.'
        : '只下載你擁有權利的內容(自己的、Creative Commons、免版稅、或已授權)。不繞過任何 DRM/付費牆。'}</p>
    </div>
  );
}
