import { useMemo, useState } from 'react';
import { FileOutput, Play, Pause, FileText } from 'lucide-react';
import './export.css';
import { Eyebrow, IconButton, Badge } from '../../components/primitives';
import { FormatLinks } from './FormatLinks';
import type { FormatChoice } from './FormatLinks';
import { FormatOptions } from './FormatOptions';
import { LivePreview } from './LivePreview';
import { ExportActions } from './ExportActions';
import { DEFAULT_CONFIG, type ExportConfig } from './exportOptions';
import { renderExport, exportFilename } from '../../lib/exporters';
import { formatClock } from '../../lib/timecode';
import { useResultStore } from '../../state/useResultStore';
import { useAudio } from '../../state/useAudio';
import { useJob } from '../../state/useJob';

export function ExportTab() {
  const result = useResultStore((s) => s.result);
  const dirty = useResultStore((s) => s.dirty);
  const currentTime = useAudio((s) => s.currentTime);
  const duration = useAudio((s) => s.duration);
  const playing = useAudio((s) => s.playing);
  const audioSrc = useAudio((s) => s.src);
  const toggle = useAudio((s) => s.toggle);
  const seek = useAudio((s) => s.seek);
  const jobId = useJob((s) => s.jobId);

  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG);

  const patch = (p: Partial<ExportConfig>) =>
    setConfig((c) => ({ ...c, ...p }));

  // FormatLinks owns fmt+level together; merge into the config.
  const choice: FormatChoice = { fmt: config.fmt, level: config.level };
  const onChoice = (c: FormatChoice) => patch({ fmt: c.fmt, level: c.level });

  const stats = useMemo(() => {
    if (!result) return { lines: 0, chars: 0 };
    const text = renderExport(result, config.fmt, {
      level: config.level,
      precisionMs: config.precisionMs,
    });
    return { lines: text.split('\n').length, chars: text.length };
  }, [result, config.fmt, config.level, config.precisionMs]);

  if (!result) {
    return (
      <div className="al-tabpage">
        <div className="al-tabpage__head">
          <h1 className="al-tabpage__title">匯出 · Export</h1>
        </div>
        <div className="al-empty" style={{ paddingTop: '16vh' }}>
          <FileOutput size={30} strokeWidth={1.25} />
          <div className="al-empty__title">尚無可匯出的結果</div>
          <div>先辨識一首歌，再回來匯出檔案。Run a transcription first, then export here.</div>
        </div>
      </div>
    );
  }

  const canScrub = Boolean(audioSrc) && duration > 0;
  const isAss = config.fmt === 'ass';
  const filename = exportFilename(config.fmt, config.level);

  return (
    <div className="al-tabpage">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">匯出 · Export</h1>
        <p className="al-tabpage__lede">
          把文件變成檔案 — 存檔前先看一眼忠實預覽。ASS 的 \k 卡拉 OK 預覽會隨播放掃動，所見即所存。
          Turn the document into files; the ASS preview sweeps against playback so preview is proof.
        </p>
      </div>

      <div className="al-export">
        <aside className="al-export__side">
          <section>
            <Eyebrow num={1}>Format · 格式</Eyebrow>
            <div className="al-export__group">
              <FormatLinks value={choice} onChange={onChoice} />
            </div>
          </section>

          <section>
            <Eyebrow num={2}>Options · 選項</Eyebrow>
            <div className="al-export__group">
              <FormatOptions config={config} onChange={patch} />
            </div>
          </section>
        </aside>

        <main className="al-export__main">
          <div className="al-export__previewhead">
            <Eyebrow num={3} rule={false}>
              Preview · 預覽
            </Eyebrow>
            <div className="al-export__file">
              <FileText size={13} strokeWidth={1.5} />
              <span className="al-export__filename">{filename}</span>
              <span className="al-export__stats">
                {stats.lines} 行 lines · {stats.chars} 字元 chars
              </span>
            </div>
          </div>

          <LivePreview
            result={result}
            fmt={config.fmt}
            level={config.level}
            precisionMs={config.precisionMs}
            assSweep={config.assSweep}
            currentTime={currentTime}
          />

          {/* Sweep-proof transport — present so the ASS \k preview is
              demonstrably bound to playback even from the Export tab. */}
          <div
            className={`al-export__scrub${isAss ? ' al-export__scrub--live' : ''}`}
          >
            <IconButton
              label={playing ? '暫停 Pause' : '播放 Play'}
              icon={playing ? <Pause size={15} /> : <Play size={15} />}
              onClick={toggle}
              size="sm"
              active={playing}
            />
            <input
              className="al-export__seek"
              type="range"
              min={0}
              max={Math.max(duration, 0.01)}
              step={0.01}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(Number(e.currentTarget.value))}
              disabled={!canScrub}
              aria-label="掃動播放位置 Scrub playback"
            />
            <span className="al-export__clock">
              {formatClock(currentTime)} / {formatClock(duration)}
            </span>
            {isAss && (
              <Badge tone="gold" dot title="ASS \k 掃動已綁定播放">
                掃動 sweep
              </Badge>
            )}
          </div>

          <ExportActions
            result={result}
            config={config}
            dirty={dirty}
            jobId={jobId}
          />
        </main>
      </div>
    </div>
  );
}
