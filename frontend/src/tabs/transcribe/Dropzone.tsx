import { useRef, useState } from 'react';
import { FileMusic, Replace, Waves, X } from 'lucide-react';
import { IconButton } from '../../components/primitives';
import { formatClock } from '../../lib/timecode';
import { WaveformThumb } from './WaveformThumb';

export interface DropzoneProps {
  file: File | null;
  durationSec: number;
  onFile: (file: File) => void;
  onClear: () => void;
}

const ACCEPT = '.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,audio/*';
const ACCEPT_EXT = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isAudio(f: File): boolean {
  if (f.type.startsWith('audio/')) return true;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return ACCEPT_EXT.includes(ext);
}

/** A single labelled fact in the parsed-meta strip. */
function MetaFact({ k, v, tone }: { k: string; v: string; tone?: 'gold' }) {
  return (
    <div className="al-filecard__fact">
      <span className="al-filecard__factk">{k}</span>
      <span
        className="al-filecard__factv"
        style={tone === 'gold' ? { color: 'var(--al-gold-soft)' } : undefined}
      >
        {v}
      </span>
    </div>
  );
}

/** Typeset drop target → waveform thumbnail + parsed file-meta card. */
export function Dropzone({ file, durationSec, onFile, onClear }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState(false);

  const pick = () => inputRef.current?.click();

  const accept = (f: File | undefined | null) => {
    if (!f) return;
    if (!isAudio(f)) {
      setRejected(true);
      window.setTimeout(() => setRejected(false), 2600);
      return;
    }
    setRejected(false);
    onFile(f);
  };

  if (file) {
    const ext = file.name.split('.').pop()?.toUpperCase() ?? 'AUDIO';
    return (
      <div className="al-filecard">
        <div className="al-filecard__thumb">
          <WaveformThumb file={file} />
        </div>

        <div className="al-filecard__body">
          <div className="al-filecard__name" title={file.name}>
            <FileMusic
              size={14}
              strokeWidth={1.75}
              style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--al-gold)' }}
            />
            {file.name}
          </div>
          <div className="al-filecard__facts">
            <MetaFact k="格式 Format" v={ext} tone="gold" />
            <MetaFact k="長度 Length" v={durationSec > 0 ? formatClock(durationSec) : '—'} />
            <MetaFact k="大小 Size" v={prettyBytes(file.size)} />
            <MetaFact k="聲道 Mix" v="↓ mono" />
          </div>
        </div>

        <div className="al-filecard__actions">
          <IconButton
            label="換一首 Replace file"
            icon={<Replace size={15} />}
            size="sm"
            onClick={pick}
          />
          <IconButton
            label="移除檔案 Remove file"
            icon={<X size={16} />}
            size="sm"
            onClick={onClear}
          />
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={[
        'al-dropzone',
        over ? 'al-dropzone--over' : '',
        rejected ? 'al-dropzone--reject' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="拖放或選擇一首歌 Drop or choose a song file"
      aria-invalid={rejected || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        accept(e.dataTransfer.files?.[0]);
      }}
    >
      <span className="al-dropzone__icon" aria-hidden="true">
        <Waves size={26} strokeWidth={1.4} />
      </span>
      <div className="al-dropzone__lead">拖一首歌進來 — 它會變成一頁。</div>
      <div className="al-dropzone__sub" role="status" aria-live="polite">
        {rejected ? (
          <span className="al-dropzone__reject">
            這不是音訊檔。Not an audio file — try MP3 · WAV · FLAC · M4A.
          </span>
        ) : (
          <>Drop a song; it becomes a page. — MP3 · WAV · FLAC · M4A</>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
