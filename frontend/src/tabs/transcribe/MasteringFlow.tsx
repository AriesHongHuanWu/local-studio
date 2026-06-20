/* ──────────────────────────────────────────────────────────────────
   MasteringFlow — Auto-Mastering (母帶) mode surface.

   Drop a mix → pick a genre + loudness target (+ optional reference
   track) → the local DSP chain (EQ / compression / width / loudness /
   true-peak limit) renders a release-ready master. A/B the original vs
   mastered, see the loudness numbers, and download a 24-bit WAV.

   Self-contained (own picker, job + poll), mirroring CleanTextFlow.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Disc3, UploadCloud, Sparkles, Download, Loader2, Music2,
  SlidersHorizontal, ChevronRight, ChevronDown, Gauge, Wand2,
} from 'lucide-react';
import { Button, Eyebrow } from '../../components/primitives';
import { createMasterJob, getMasterJob, masterResultUrl, analyzeMaster } from '../../api/master';
import type { MasterLoudness, MasterMeta, MasterAnalysis } from '../../api/master';
import { ApiError } from '../../api/client';
import { useMeta } from '../../state/useMeta';
import { useT } from '../../i18n';
import type { TFn } from '../../i18n';
import { AnalysisPanel, ResultCompare } from './mastering/AnalysisPanel';
import { Goniometer } from './mastering/Goniometer';
import { GainReduction } from './mastering/GainReduction';
import { SignalChain } from './mastering/SignalChain';
import { fmtDb } from './mastering/vizUtils';
import './mastering.css';

const POLL_MS = 700;
type Phase = 'idle' | 'running' | 'done' | 'error';

const LOUDNESS: { key: MasterLoudness; lufs: string }[] = [
  { key: 'streaming', lufs: '−14 LUFS' },
  { key: 'balanced', lufs: '−12 LUFS' },
  { key: 'social', lufs: '−9 LUFS' },
];

const TARGET_LUFS: Record<string, number> = { streaming: -14, balanced: -12, social: -9 };

export function MasteringFlow() {
  const t = useT();
  const meta = useMeta((s) => s.meta);
  const genres = meta.masterGenres && meta.masterGenres.length
    ? meta.masterGenres
    : [{ key: 'auto', label: 'Auto' }];

  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [genre, setGenre] = useState('auto');
  const [loudness, setLoudness] = useState<MasterLoudness>('streaming');

  // Auto-correction strength (0.2 natural ↔ 1.0 strong) for intelligent mode.
  const [autoStrength, setAutoStrength] = useState(0.6);

  // Section macro-dynamics (−1 balance ↔ +1 punch) + advanced manual params.
  const [dynamics, setDynamics] = useState(0);
  const [showAdv, setShowAdv] = useState(false);
  const [eqBass, setEqBass] = useState(0);
  const [eqLowMid, setEqLowMid] = useState(0);
  const [eqPresence, setEqPresence] = useState(0);
  const [eqAir, setEqAir] = useState(0);
  const [compScale, setCompScale] = useState(1);
  const [width, setWidth] = useState(1);
  const [ceiling, setCeiling] = useState(-1);
  const resetAdv = useCallback(() => {
    setEqBass(0); setEqLowMid(0); setEqPresence(0); setEqAir(0);
    setCompScale(1); setWidth(1); setCeiling(-1);
  }, []);

  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<MasterMeta | null>(null);

  // Intelligent analysis (smart diagnosis) — best-effort, never blocks mastering.
  const [analysis, setAnalysis] = useState<MasterAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzeAbort = useRef<AbortController | null>(null);


  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  // Revoke the previous object URL + stop any in-flight job poll when the
  // source changes. (Analyze is NOT aborted here — it has its own controller
  // and starts in the same render that changes srcUrl.)
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (srcUrl) URL.revokeObjectURL(srcUrl);
    };
  }, [srcUrl]);

  // Unmount-only: abort any pending analysis request + clear debounce timer.
  useEffect(() => {
    return () => {
      analyzeAbort.current?.abort();
      if (strengthTimer.current) clearTimeout(strengthTimer.current);
    };
  }, []);

  const strengthTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAnalyze = useCallback((f: File, g: string, strength: number) => {
    if (meta.mastering === false) return;
    analyzeAbort.current?.abort();
    const ac = new AbortController();
    analyzeAbort.current = ac;
    setAnalyzing(true);
    void (async () => {
      try {
        const a = await analyzeMaster(f, g, strength, ac.signal);
        if (ac.signal.aborted) return;
        setAnalysis(a);
      } catch {
        if (ac.signal.aborted) return;
        setAnalysis(null); // analysis is optional; mastering still works
      } finally {
        if (!ac.signal.aborted) setAnalyzing(false);
      }
    })();
  }, [meta.mastering]);

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);
    setSrcUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setPhase('idle');
    setResultUrl(null);
    setResultMeta(null);
    setErrorMsg(null);
    setAnalysis(null);
    runAnalyze(f, genre, autoStrength);
  }, [genre, autoStrength, runAnalyze]);

  const pickGenre = useCallback((g: string) => {
    setGenre(g);
    if (file) runAnalyze(file, g, autoStrength);
  }, [file, autoStrength, runAnalyze]);

  // Re-analyze (debounced) when the strength dial settles, so the panel +
  // suggestion chips reflect the chosen aggressiveness.
  const pickStrength = useCallback((v: number) => {
    setAutoStrength(v);
    if (strengthTimer.current) clearTimeout(strengthTimer.current);
    if (file && genre === 'auto') {
      strengthTimer.current = setTimeout(() => runAnalyze(file, genre, v), 350);
    }
  }, [file, genre, runAnalyze]);

  const poll = useCallback(
    async (id: string) => {
      if (stoppedRef.current) return;
      try {
        const st = await getMasterJob(id);
        if (stoppedRef.current) return;
        setPct(st.pct ?? 0);
        setMessage(st.message ?? '');
        if (st.status === 'done') {
          setPct(100);
          setPhase('done');
          setResultUrl(`${masterResultUrl(id)}?t=${Date.now()}`);
          setResultMeta(st.meta);
          return;
        }
        if (st.status === 'error') {
          setErrorMsg(st.error || t('master.error.job'));
          setPhase('error');
          return;
        }
        pollTimer.current = setTimeout(() => void poll(id), POLL_MS);
      } catch (err: unknown) {
        if (stoppedRef.current) return;
        setErrorMsg(
          err instanceof ApiError && err.offline ? t('master.error.offline') : t('master.error.job'),
        );
        setPhase('error');
      }
    },
    [t],
  );

  const run = useCallback(() => {
    if (!file) return;
    stoppedRef.current = false;
    setPhase('running');
    setPct(0);
    setMessage(t('master.preparing'));
    setErrorMsg(null);
    setResultUrl(null);
    setResultMeta(null);
    void (async () => {
      try {
        const { jobId } = await createMasterJob(file, genre, loudness, reference, {
          dynamics,
          width,
          eqBass,
          eqLowMid,
          eqPresence,
          eqAir,
          compScale,
          ceiling,
          auto: genre === 'auto',
          autoStrength,
        });
        if (stoppedRef.current) return;
        pollTimer.current = setTimeout(() => void poll(jobId), POLL_MS);
      } catch (err: unknown) {
        if (stoppedRef.current) return;
        setErrorMsg(
          err instanceof ApiError && err.offline ? t('master.error.offline') : t('master.error.job'),
        );
        setPhase('error');
      }
    })();
  }, [file, genre, loudness, reference, dynamics, width, eqBass, eqLowMid, eqPresence, eqAir, compScale, ceiling, autoStrength, poll, t]);

  const running = phase === 'running';
  const isDone = phase === 'done' && !!resultUrl;
  const isError = phase === 'error';

  return (
    <div className="al-tabpage">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{t('master.title')}</h1>
        <p className="al-tabpage__lede">{t('master.lede')}</p>
      </div>

      {/* 01 SOURCE */}
      <section className="al-section">
        <Eyebrow num={1}>{t('master.section.source')}</Eyebrow>
        <label className="al-master__drop">
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.m4a,.aac,.ogg"
            className="al-master__file"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <UploadCloud size={22} />
          <span className="al-master__dropmain">
            {file ? file.name : t('master.drop')}
          </span>
          <span className="al-master__drophint">WAV · MP3 · FLAC · M4A</span>
        </label>
        {srcUrl && (
          <div className="al-master__player">
            <span className="al-master__playerlabel">{t('master.original')}</span>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={srcUrl} controls className="al-master__audio" />
          </div>
        )}
      </section>

      {/* 02 SMART ANALYSIS */}
      {(analyzing || analysis) && (
        <section className="al-section">
          <Eyebrow num={2}>
            <span className="al-master__anhead"><Gauge size={13} /> {t('master.section.analysis')}</span>
          </Eyebrow>
          {analyzing && !analysis && (
            <div className="al-master__analyzing">
              <Loader2 size={15} className="al-spin" /> {t('master.analyzing')}
            </div>
          )}
          {analysis && (
            <>
              {genre === 'auto' && (
                <>
                  <AutoSummary corrections={analysis.corrections} t={t} />
                  <div className="al-master__strength">
                    <div className="al-master__strengthhead">
                      <span className="al-master__strengthlabel">{t('master.strength.label')}</span>
                      <span className="al-master__strengthval">
                        {autoStrength <= 0.4 ? t('master.strength.natural')
                          : autoStrength >= 0.8 ? t('master.strength.strong')
                            : t('master.strength.balanced')}
                      </span>
                    </div>
                    <div className="al-master__strengthrow">
                      <span className="al-master__dynend">{t('master.strength.natural')}</span>
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={5}
                        value={Math.round(autoStrength * 100)}
                        onChange={(e) => pickStrength(Number(e.target.value) / 100)}
                        className="al-master__range"
                        disabled={running}
                        aria-label={t('master.strength.label')}
                      />
                      <span className="al-master__dynend">{t('master.strength.strong')}</span>
                    </div>
                    <p className="al-master__hint">{t('master.strength.hint')}</p>
                  </div>
                </>
              )}
              <AnalysisPanel analysis={analysis} targetLufs={TARGET_LUFS[loudness]} />
            </>
          )}
        </section>
      )}

      {/* 03 STYLE */}
      <section className="al-section">
        <Eyebrow num={3}>{t('master.section.style')}</Eyebrow>
        <p className="al-master__sub">{t('master.genreLabel')}</p>
        <div className="al-master__genres">
          {genres.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`al-master__chip${genre === g.key ? ' al-master__chip--active' : ''}`}
              onClick={() => pickGenre(g.key)}
              disabled={running}
            >
              {g.label}
            </button>
          ))}
        </div>

        <p className="al-master__sub">{t('master.refLabel')}</p>
        <label className="al-master__reframe">
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.m4a"
            className="al-master__file"
            onChange={(e) => setReference(e.target.files?.[0] ?? null)}
          />
          <Music2 size={15} />
          <span>{reference ? reference.name : t('master.refDrop')}</span>
          {reference && (
            <button
              type="button"
              className="al-master__refclear"
              onClick={(e) => {
                e.preventDefault();
                setReference(null);
              }}
            >
              ✕
            </button>
          )}
        </label>
        <p className="al-master__hint">{t('master.refHint')}</p>
      </section>

      {/* 04 LOUDNESS */}
      <section className="al-section">
        <Eyebrow num={4}>{t('master.section.loudness')}</Eyebrow>
        <div className="al-master__loudness">
          {LOUDNESS.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`al-master__loudbtn${loudness === l.key ? ' al-master__loudbtn--active' : ''}`}
              onClick={() => setLoudness(l.key)}
              disabled={running}
            >
              <span className="al-master__loudname">{t(`master.loud.${l.key}`)}</span>
              <span className="al-master__loudval">{l.lufs}</span>
              <span className="al-master__louddesc">{t(`master.loudDesc.${l.key}`)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 05 DYNAMICS — section-aware (verse/chorus) */}
      <section className="al-section">
        <Eyebrow num={5}>{t('master.section.dynamics')}</Eyebrow>
        <div className="al-master__dynrow">
          <span className="al-master__dynend">{t('master.dyn.balance')}</span>
          <input
            type="range"
            min={-100}
            max={100}
            step={5}
            value={Math.round(dynamics * 100)}
            onChange={(e) => setDynamics(Number(e.target.value) / 100)}
            className="al-master__range al-master__range--center"
            disabled={running}
            aria-label={t('master.section.dynamics')}
          />
          <span className="al-master__dynend">{t('master.dyn.punch')}</span>
        </div>
        <p className="al-master__hint">
          {dynamics > 0.05
            ? t('master.dyn.punchHint')
            : dynamics < -0.05
              ? t('master.dyn.balanceHint')
              : t('master.dyn.offHint')}
        </p>
      </section>

      {/* 05 ADVANCED — manual fine control */}
      <section className="al-section">
        <button
          type="button"
          className="al-master__advtoggle"
          onClick={() => setShowAdv((v) => !v)}
          aria-expanded={showAdv}
        >
          {showAdv ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <SlidersHorizontal size={14} /> {t('master.advanced')}
        </button>
        {showAdv && (
          <div className="al-master__adv">
            <p className="al-master__advgroup">{t('master.adv.eq')}</p>
            <Slider label={t('master.adv.bass')} value={eqBass} onChange={setEqBass} min={-12} max={12} step={0.5} unit="dB" disabled={running} />
            <Slider label={t('master.adv.lowMid')} value={eqLowMid} onChange={setEqLowMid} min={-12} max={12} step={0.5} unit="dB" disabled={running} />
            <Slider label={t('master.adv.presence')} value={eqPresence} onChange={setEqPresence} min={-12} max={12} step={0.5} unit="dB" disabled={running} />
            <Slider label={t('master.adv.air')} value={eqAir} onChange={setEqAir} min={-12} max={12} step={0.5} unit="dB" disabled={running} />
            <p className="al-master__advgroup">{t('master.adv.dynamicsGroup')}</p>
            <Slider label={t('master.adv.comp')} value={compScale} onChange={setCompScale} min={0} max={2} step={0.05} unit="×" disabled={running} />
            <Slider label={t('master.adv.width')} value={width} onChange={setWidth} min={0.5} max={1.5} step={0.05} unit="×" disabled={running} />
            <Slider label={t('master.adv.ceiling')} value={ceiling} onChange={setCeiling} min={-6} max={0} step={0.1} unit="dBTP" disabled={running} />
            <button type="button" className="al-master__advreset" onClick={resetAdv} disabled={running}>
              {t('master.adv.reset')}
            </button>
          </div>
        )}
      </section>

      {/* RUN */}
      <section className="al-section">
        <Button
          variant="primary"
          size="lg"
          icon={running ? <Loader2 size={18} className="al-spin" /> : <Sparkles size={18} />}
          disabled={running || !file || meta.mastering === false}
          onClick={run}
        >
          {running ? t('master.running') : isDone ? t('master.rerun') : t('master.start')}
        </Button>
        {meta.mastering === false && <p className="al-master__hint">{t('master.unavailable')}</p>}
      </section>

      {(running || isError) && (
        <div className={`al-clean__progress${isError ? ' al-clean__progress--error' : ''}`}>
          {!isError && (
            <div className="al-progressbar" aria-hidden="true">
              <div className="al-progressbar__fill" style={{ width: `${Math.round(pct)}%` }} />
            </div>
          )}
          <div className="al-clean__progressfoot">
            <span className={isError ? 'al-clean__msg--error' : 'al-clean__msg'}>
              {isError ? errorMsg : message}
            </span>
            {!isError && <span className="al-clean__pct">{Math.round(pct)}%</span>}
          </div>
        </div>
      )}

      {/* RESULT */}
      {isDone && resultUrl && (
        <section className="al-section">
          <Eyebrow num={6}>{t('master.section.result')}</Eyebrow>
          <div className="al-master__result">
            <div className="al-master__player">
              <span className="al-master__playerlabel al-master__playerlabel--gold">
                <Disc3 size={13} /> {t('master.mastered')}
              </span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio src={resultUrl} controls autoPlay className="al-master__audio" />
            </div>

            {resultMeta?.chain && (
              <div className="al-an__block">
                <span className="al-an__blocktitle">{t('master.an.chain')}</span>
                <SignalChain chain={resultMeta.chain} />
              </div>
            )}

            {resultMeta?.meters && (resultMeta.meters.multiband?.active || resultMeta.meters.deess?.active) && (
              <div className="al-an__block">
                <span className="al-an__blocktitle">{t('master.an.gr')}</span>
                <GainReduction meters={resultMeta.meters} />
              </div>
            )}

            {resultMeta?.goniometer && (
              <div className="al-an__block">
                <span className="al-an__blocktitle">{t('master.an.imager')}</span>
                <Goniometer data={resultMeta.goniometer} />
              </div>
            )}

            {resultMeta?.before && resultMeta?.after && (
              <ResultCompare
                before={resultMeta.before}
                after={resultMeta.after}
                targetLufs={resultMeta.targetLufs}
              />
            )}

            {resultMeta && (
              <div className="al-master__stats">
                <Stat label={t('master.stat.loudness')} value={`${resultMeta.outputLufs} LUFS`} sub={`→ ${resultMeta.targetLufs}`} />
                <Stat label={t('master.stat.peak')} value={`${resultMeta.outputPeakDb} dB`} sub={`≤ ${resultMeta.ceilingDb}`} />
                <Stat label={t('master.stat.gain')} value={`${(resultMeta.outputLufs - resultMeta.inputLufs >= 0 ? '+' : '')}${(resultMeta.outputLufs - resultMeta.inputLufs).toFixed(1)} dB`} sub={t('master.stat.gainSub')} />
                <Stat label={t('master.stat.source')} value={resultMeta.referenceUsed ? t('master.stat.reference') : (genres.find((g) => g.key === resultMeta.genre)?.label ?? resultMeta.genre)} sub="" />
              </div>
            )}

            <Button
              variant="primary"
              size="md"
              icon={<Download size={15} />}
              onClick={() => {
                const a = document.createElement('a');
                a.href = resultUrl;
                a.download = 'mastered.wav';
                a.click();
              }}
            >
              {t('master.download')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Slider({
  label, value, onChange, min, max, step, unit, disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
}) {
  return (
    <label className="al-master__slider">
      <span className="al-master__sliderlabel">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="al-master__range"
        disabled={disabled}
        aria-label={label}
      />
      <span className="al-master__sliderval">
        {value > 0 && unit === 'dB' ? '+' : ''}
        {value}
        <span className="al-master__sliderunit">{unit}</span>
      </span>
    </label>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="al-master__stat">
      <span className="al-master__statlabel">{label}</span>
      <span className="al-master__statvalue">{value}</span>
      {sub && <span className="al-master__statsub">{sub}</span>}
    </div>
  );
}

const AUTO_BAND_LABEL: Record<string, string> = {
  sub: 'master.band.sub',
  bass: 'master.band.bass',
  low_mid: 'master.band.lowMid',
  mid: 'master.band.mid',
  high_mid: 'master.band.highMid',
  presence: 'master.band.presence',
  air: 'master.band.air',
};

/** Transparent summary of what intelligent "Auto" mode will apply. */
function AutoSummary({ corrections, t }: { corrections: MasterAnalysis['corrections']; t: TFn }) {
  const chips: string[] = [];
  for (const [b, g] of Object.entries(corrections.eq_band_gains_db)) {
    if (Math.abs(g) >= 0.8) chips.push(`${t(AUTO_BAND_LABEL[b] ?? b)} ${fmtDb(g)}`);
  }
  if (corrections.low_cut_hz > 0) chips.push(`${t('master.auto.lowcut')} ${corrections.low_cut_hz}Hz`);
  if (corrections.mono_below_hz > 0) chips.push(`${t('master.auto.monobass')} ${corrections.mono_below_hz}Hz`);
  if (Math.abs(corrections.width_factor - 1) > 0.02) {
    chips.push(`${t('master.auto.width')} ×${corrections.width_factor.toFixed(2)}`);
  }
  if (Math.abs(corrections.section_amount) > 0.02) {
    const lbl = corrections.section_amount > 0 ? t('master.dyn.punch') : t('master.dyn.balance');
    chips.push(`${lbl} ${fmtDb(corrections.section_amount * 100, 0)}%`);
  }
  return (
    <div className="al-master__autobar">
      <span className="al-master__autohead"><Wand2 size={13} /> {t('master.auto.title')}</span>
      {chips.length ? (
        <div className="al-master__autochips">
          {chips.map((c, i) => <span key={i} className="al-master__autochip">{c}</span>)}
        </div>
      ) : (
        <span className="al-master__autoclean">{t('master.auto.clean')}</span>
      )}
    </div>
  );
}
