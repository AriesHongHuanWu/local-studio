import { HardDrive } from 'lucide-react';

/**
 * LocalAssurance — the local-first footer line. A quiet trust signal for
 * this GPU-first, offline audience: nothing here ever leaves the machine.
 */
export function LocalAssurance() {
  return (
    <div className="al-assurance">
      <HardDrive size={14} strokeWidth={1.5} aria-hidden="true" />
      <span>一切都在這台機器上 — 不會外傳。Everything stays on this machine.</span>
    </div>
  );
}
