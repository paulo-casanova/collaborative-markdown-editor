/**
 * Custom Pill / Badge parsing and styling utilities.
 * Supports:
 *   [pill:color|label] - e.g. [pill:green|Approved], [pill:amber|In Progress], [pill:#7c3aed|VIP]
 *   [pill:label]       - e.g. [pill:Draft] (defaults to neutral slate)
 *   [status:done|in-progress|blocked]
 *   [priority:p0|high|medium|low]
 */

export interface PillStyleInfo {
  bgClass: string;
  textClass: string;
  borderClass: string;
  dotColor: string;
}

export interface ParsedPill {
  raw: string;
  color: string;
  label: string;
  isCustomHex: boolean;
}

export function parsePillSyntax(raw: string): ParsedPill | null {
  const match = raw.match(/^\[(pill|status|priority):(?:([a-zA-Z0-9#_-]+)\|)?([^\]\n]+)\]$/);
  if (!match) return null;

  const prefixType = match[1];
  const rawColor = match[2];
  const rawLabel = match[3].trim();

  let color = rawColor || 'slate';
  let label = rawLabel;

  if (prefixType === 'status') {
    const norm = rawLabel.toLowerCase();
    if (norm === 'done' || norm === 'completed' || norm === 'resolved') {
      color = 'green';
      label = 'Done';
    } else if (norm === 'in-progress' || norm === 'in progress' || norm === 'wip' || norm === 'pending') {
      color = 'amber';
      label = 'In Progress';
    } else if (norm === 'blocked' || norm === 'cancelled' || norm === 'rejected') {
      color = 'rose';
      label = 'Blocked';
    } else {
      color = rawColor || 'blue';
      label = rawLabel;
    }
  } else if (prefixType === 'priority') {
    const norm = rawLabel.toLowerCase();
    if (norm === 'p0' || norm === 'urgent' || norm === 'high' || norm === 'critical') {
      color = 'rose';
      label = rawLabel.toUpperCase();
    } else if (norm === 'p1' || norm === 'medium') {
      color = 'amber';
      label = rawLabel.toUpperCase();
    } else {
      color = 'blue';
      label = rawLabel.toUpperCase();
    }
  }

  const isCustomHex = color.startsWith('#');

  return {
    raw,
    color,
    label,
    isCustomHex,
  };
}

export function resolvePillStyle(colorName?: string): PillStyleInfo {
  const norm = (colorName || 'slate').toLowerCase().trim();

  switch (norm) {
    case 'green':
    case 'emerald':
    case 'success':
      return {
        bgClass: 'bg-emerald-500/15',
        textClass: 'text-emerald-700 dark:text-emerald-300',
        borderClass: 'border-emerald-500/30',
        dotColor: '#10b981',
      };
    case 'amber':
    case 'yellow':
    case 'warning':
      return {
        bgClass: 'bg-amber-500/15',
        textClass: 'text-amber-700 dark:text-amber-300',
        borderClass: 'border-amber-500/30',
        dotColor: '#f59e0b',
      };
    case 'red':
    case 'rose':
    case 'danger':
    case 'error':
      return {
        bgClass: 'bg-rose-500/15',
        textClass: 'text-rose-700 dark:text-rose-300',
        borderClass: 'border-rose-500/30',
        dotColor: '#f43f5e',
      };
    case 'blue':
    case 'sky':
    case 'info':
      return {
        bgClass: 'bg-sky-500/15',
        textClass: 'text-sky-700 dark:text-sky-300',
        borderClass: 'border-sky-500/30',
        dotColor: '#0ea5e9',
      };
    case 'purple':
    case 'violet':
    case 'indigo':
      return {
        bgClass: 'bg-purple-500/15',
        textClass: 'text-purple-700 dark:text-purple-300',
        borderClass: 'border-purple-500/30',
        dotColor: '#a855f7',
      };
    case 'pink':
    case 'fuchsia':
      return {
        bgClass: 'bg-pink-500/15',
        textClass: 'text-pink-700 dark:text-pink-300',
        borderClass: 'border-pink-500/30',
        dotColor: '#ec4899',
      };
    case 'teal':
    case 'cyan':
      return {
        bgClass: 'bg-teal-500/15',
        textClass: 'text-teal-700 dark:text-teal-300',
        borderClass: 'border-teal-500/30',
        dotColor: '#14b8a6',
      };
    case 'gray':
    case 'grey':
    case 'slate':
    case 'neutral':
    default:
      return {
        bgClass: 'bg-cme-bg-subtle',
        textClass: 'text-cme-text-muted',
        borderClass: 'border-cme-border-base',
        dotColor: '#94a3b8',
      };
  }
}
