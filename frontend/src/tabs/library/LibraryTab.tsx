import { useMemo, useState } from 'react';
import { Library as LibraryIcon, Trash2, ArrowDownUp } from 'lucide-react';
import './library.css';
import { Eyebrow } from '../../components/primitives';
import { RunRow } from './RunRow';
import { RunSearch } from './RunSearch';
import { LocalAssurance } from './LocalAssurance';
import { SAMPLE_RUNS } from './sampleRuns';
import { MODE_LABEL, languageLabel } from './runMeta';
import { useLibrary } from '../../state/useLibrary';
import { useResultStore } from '../../state/useResultStore';
import { useSettings } from '../../state/useSettings';
import type { RunRecord } from '../../state/useLibrary';
import type { Defaults } from '../../state/useSettings';
import type { ModelSize, Engine } from '../../api/types';
import type { TabKey } from '../../components/shell/tabs';

export interface LibraryTabProps {
  onNavigate: (tab: TabKey) => void;
}

type SortKey = 'recent' | 'title' | 'duration';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '最新 Recent' },
  { key: 'title', label: '名稱 Name' },
  { key: 'duration', label: '時長 Duration' },
];

const VALID_MODELS: ModelSize[] = ['large-v3', 'medium', 'small'];
function asModelSize(v: string): ModelSize | undefined {
  return (VALID_MODELS as string[]).includes(v) ? (v as ModelSize) : undefined;
}
function asEngine(v: string): Engine | undefined {
  return v === 'whisper' ? 'whisper' : undefined;
}

/** Past-run list + search; reopen / re-export / duplicate-settings / delete. */
export function LibraryTab({ onNavigate }: LibraryTabProps) {
  const runs = useLibrary((s) => s.runs);
  const remove = useLibrary((s) => s.remove);
  const clearAll = useLibrary((s) => s.clear);
  const loadResult = useResultStore((s) => s.load);
  const setDefaults = useSettings((s) => s.set);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  // The library is empty AND there's no real history → show built-in sample
  // rows so the tab is fully designable / visible offline (never blank).
  const usingSamples = runs.length === 0;
  const source: RunRecord[] = usingSamples ? SAMPLE_RUNS : runs;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? source.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            MODE_LABEL[r.mode].toLowerCase().includes(q) ||
            r.mode.toLowerCase().includes(q) ||
            r.language.toLowerCase().includes(q) ||
            languageLabel(r.language).toLowerCase().includes(q) ||
            r.modelSize.toLowerCase().includes(q) ||
            r.engine.toLowerCase().includes(q),
        )
      : source.slice();

    rows.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'duration') return b.durationSec - a.durationSec;
      return b.createdAt - a.createdAt; // recent
    });
    return rows;
  }, [source, query, sort]);

  const open = (run: RunRecord) => {
    loadResult(run.result);
    onNavigate('editor');
  };
  const reExport = (run: RunRecord) => {
    loadResult(run.result);
    onNavigate('export');
  };
  const duplicate = (run: RunRecord) => {
    // Carry the run's settings forward so Transcribe opens pre-filled.
    const patch: Partial<Defaults> = {
      mode: run.mode,
      language: run.language || null,
    };
    const ms = asModelSize(run.modelSize);
    if (ms) patch.modelSize = ms;
    const eng = asEngine(run.engine);
    if (eng) patch.engine = eng;
    setDefaults(patch);
    onNavigate('transcribe');
  };

  const cycleSort = () => {
    const i = SORTS.findIndex((s) => s.key === sort);
    setSort(SORTS[(i + 1) % SORTS.length].key);
  };
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? '';

  const noMatches = filtered.length === 0;

  return (
    <div className="al-tabpage">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">紀錄 · Library</h1>
        <p className="al-tabpage__lede">
          這台機器上的歷次辨識 — 重新開啟、重新匯出、複製設定。每筆都標明用了哪個模型與引擎。
          Past runs on this machine; each shows which model + engine produced it.
        </p>
      </div>

      <div className="al-library">
        <div className="al-library__toolbar">
          <RunSearch
            value={query}
            onChange={setQuery}
            count={filtered.length}
            total={source.length}
          />
          <button
            type="button"
            className="al-library__sort"
            onClick={cycleSort}
            title="排序方式 Sort order"
            aria-label={`排序：${sortLabel}。點按切換 Sort: ${sortLabel}, click to change`}
          >
            <ArrowDownUp size={14} />
            <span className="al-library__sort-label">{sortLabel}</span>
          </button>
          {!usingSamples && runs.length > 0 && (
            <button
              type="button"
              className="al-library__clear"
              onClick={() => {
                if (
                  window.confirm(
                    `清除全部 ${runs.length} 筆本機紀錄？此動作無法復原。\nClear all ${runs.length} local runs? This cannot be undone.`,
                  )
                ) {
                  clearAll();
                }
              }}
              title="清除全部紀錄 Clear all runs"
            >
              <Trash2 size={14} />
              <span>清除全部 Clear all</span>
            </button>
          )}
        </div>

        {usingSamples && (
          <div className="al-library__samplenote">
            尚無本機紀錄 — 以下為示意，辨識完成後會出現在這裡。
            No local runs yet — these are samples; finished runs appear here.
          </div>
        )}

        {noMatches ? (
          <div className="al-library__empty">
            <LibraryIcon size={26} strokeWidth={1.25} aria-hidden="true" />
            <div className="al-library__empty-title">找不到符合的紀錄</div>
            <div className="al-library__empty-sub">
              換個關鍵字試試。Try a different search.
            </div>
          </div>
        ) : (
          <div className="al-runlist" role="list">
            <div className="al-runhead" aria-hidden="true">
              <Eyebrow rule={false}>歌名 Title</Eyebrow>
              <Eyebrow rule={false}>模式 Mode</Eyebrow>
              <Eyebrow rule={false}>時長 Dur.</Eyebrow>
              <Eyebrow rule={false}>模型 · 引擎 Model · engine</Eyebrow>
              <Eyebrow rule={false}>日期 Date</Eyebrow>
              <Eyebrow rule={false}>狀態 Status</Eyebrow>
              <span />
            </div>
            {filtered.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                sample={usingSamples}
                onOpen={open}
                onReExport={reExport}
                onDuplicate={duplicate}
                onDelete={remove}
              />
            ))}
          </div>
        )}

        <LocalAssurance />
      </div>
    </div>
  );
}
