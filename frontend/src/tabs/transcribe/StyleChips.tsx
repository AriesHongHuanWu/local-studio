import type { ReactNode } from 'react';
import {
  Music2,
  Heart,
  Guitar,
  Mic,
  Radio,
  Trees,
  Disc3,
  Piano,
  Baby,
  Tag,
} from 'lucide-react';
import { Pill, TextAreaField } from '../../components/primitives';
import type { StyleOption } from '../../api/types';

export interface StyleChipsProps {
  styles: StyleOption[];
  selected: string[];
  onToggle: (key: string) => void;
  contentHint: string;
  onContentHint: (text: string) => void;
}

/** Quiet icon-per-genre map; unknown keys fall back to a generic tag. */
const STYLE_ICON: Record<string, ReactNode> = {
  pop: <Music2 size={12} strokeWidth={2} />,
  ballad: <Heart size={12} strokeWidth={2} />,
  rock: <Guitar size={12} strokeWidth={2} />,
  rap: <Mic size={12} strokeWidth={2} />,
  electronic: <Radio size={12} strokeWidth={2} />,
  folk: <Trees size={12} strokeWidth={2} />,
  rnb: <Disc3 size={12} strokeWidth={2} />,
  jazz: <Disc3 size={12} strokeWidth={2} />,
  classical: <Piano size={12} strokeWidth={2} />,
  kids: <Baby size={12} strokeWidth={2} />,
};

function iconFor(key: string): ReactNode {
  return STYLE_ICON[key] ?? <Tag size={12} strokeWidth={2} />;
}

/** Genre pill chips + freeform content hint → styleKeys + referenceContent. */
export function StyleChips({
  styles,
  selected,
  onToggle,
  contentHint,
  onContentHint,
}: StyleChipsProps) {
  return (
    <div className="al-stylechips">
      <div className="al-stylechips__label">
        風格 Style
        {selected.length > 0 && (
          <span className="al-stylechips__count"> · {selected.length}</span>
        )}
      </div>
      <div className="al-chips">
        {styles.map((s) => (
          <Pill
            key={s.key}
            active={selected.includes(s.key)}
            onClick={() => onToggle(s.key)}
            icon={iconFor(s.key)}
          >
            {s.label}
          </Pill>
        ))}
      </div>

      <TextAreaField
        label="內容提示 Content hint"
        value={contentHint}
        onChange={(e) => onContentHint(e.target.value)}
        placeholder="例如：歌名、歌手、專有名詞、副歌關鍵字… e.g. title, artist, proper nouns, hook keywords…"
        hint="自由文字 — 餵給辨識器當偏向線索。Freeform — biases the recognizer toward these words."
        style={{ minHeight: 68 }}
        spellCheck={false}
      />
    </div>
  );
}
