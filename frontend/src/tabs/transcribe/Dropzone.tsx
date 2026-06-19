import { useRef, useState } from 'react';
import { FileMusic, FileVideo, Film, Replace, Waves, X } from 'lucide-react';
import { IconButton } from '../../components/primitives';
import { formatClock } from '../../lib/timecode';
import { WaveformThumb } from './WaveformThumb';
import { useT } from '../../i18n';
import type { AppMode } from '../../state/useMode';

export interface DropzoneProps {
  file: File | null;
  durationSec: number;
  onFile: (file: File) => void;
  onClear: () => void;
  /** "song" → audio only; "video" → also accept video containers. */
  mode?: AppMode;
}

const AUDIO_ACCEPT = '.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,audio/*';
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];
// Video mode accepts video containers AND audio (a video tool that also takes
// a bare audio file is friendlier — speech transcription works on both).
const VIDEO_ACCEPT =
  '.mp4,.webm,.mov,.mkv,.m4v,video/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,audio/*';
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'm4v', ...AUDIO_EXT];

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Whether a dropped file is accepted for the given mode. */
function isAccepted(f: File, mode: AppMode): boolean {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  // video + clean both take video containers (clean also tolerates a bare audio
  // file, harmless — the inpaint backend simply has no region to draw on).
  if (mode === 'video' || mode === 'clean') {
    if (f.type.startsWith('video/') || f.type.startsWith('audio/')) return true;
    return VIDEO_EXT.includes(ext);
  }
  if (f.type.startsWith('audio/')) return true;
  return AUDIO_EXT.includes(ext);
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
export function Dropzone({ file, durationSec, onFile, onClear, mode = 'song' }: DropzoneProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState(false);

  const isClean = mode === 'clean';
  // "video-like" → accepts video containers + shows the film icon (video + clean).
  const isVideo = mode === 'video' || isClean;
  const acceptAttr = isVideo ? VIDEO_ACCEPT : AUDIO_ACCEPT;
  // mode-aware copy keys: clean.* in clean mode, video.* in video mode,
  // transcribe.* in song mode.
  const ns = isClean ? 'clean' : mode === 'video' ? 'video' : 'transcribe';
  const k = {
    aria: `${ns}.drop.ariaLabel`,
    lead: `${ns}.drop.lead`,
    sub: `${ns}.drop.sub`,
    reject: `${ns}.drop.reject`,
  };

  const pick = () => inputRef.current?.click();

  const accept = (f: File | undefined | null) => {
    if (!f) return;
    if (!isAccepted(f, mode)) {
      setRejected(true);
      window.setTimeout(() => setRejected(false), 2600);
      return;
    }
    setRejected(false);
    onFile(f);
  };

  if (file) {
    const ext = file.name.split('.').pop()?.toUpperCase() ?? (isVideo ? 'VIDEO' : 'AUDIO');
    // Is the loaded file itself a video? (video mode also accepts audio.)
    const loadedIsVideo =
      file.type.startsWith('video/') ||
      ['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(
        file.name.split('.').pop()?.toLowerCase() ?? '',
      );
    const NameIcon = loadedIsVideo ? FileVideo : FileMusic;
    return (
      <div className="al-filecard">
        <div className="al-filecard__thumb">
          <WaveformThumb file={file} />
        </div>

        <div className="al-filecard__body">
          <div className="al-filecard__name" title={file.name}>
            <NameIcon
              size={14}
              strokeWidth={1.75}
              style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--al-gold)' }}
            />
            {file.name}
          </div>
          <div className="al-filecard__facts">
            <MetaFact k={t('transcribe.file.factFormat')} v={ext} tone="gold" />
            <MetaFact k={t('transcribe.file.factLength')} v={durationSec > 0 ? formatClock(durationSec) : '—'} />
            <MetaFact k={t('transcribe.file.factSize')} v={prettyBytes(file.size)} />
            <MetaFact k={t('transcribe.file.factMix')} v="↓ mono" />
          </div>
        </div>

        <div className="al-filecard__actions">
          <IconButton
            label={t('transcribe.file.replace')}
            icon={<Replace size={15} />}
            size="sm"
            onClick={pick}
          />
          <IconButton
            label={t('transcribe.file.remove')}
            icon={<X size={16} />}
            size="sm"
            onClick={onClear}
          />
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
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
      aria-label={t(k.aria)}
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
        {isVideo ? <Film size={26} strokeWidth={1.4} /> : <Waves size={26} strokeWidth={1.4} />}
      </span>
      <div className="al-dropzone__lead">{t(k.lead)}</div>
      <div className="al-dropzone__sub" role="status" aria-live="polite">
        {rejected ? (
          <span className="al-dropzone__reject">
            {t(k.reject)}
          </span>
        ) : (
          <>{t(k.sub)}</>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        hidden
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
