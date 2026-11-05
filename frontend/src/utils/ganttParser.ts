import { parse as parseYaml } from 'yaml';

export interface GanttTaskSpan {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  durationDays: number;
}

export interface RawGanttTask {
  id?: string;
  name: string;
  start?: string | string[];
  end?: string | string[];
  duration?: string | number;
  spans?: any[];
  dates?: any[];
  'depends-on'?: string | string[];
  dependsOn?: string | string[];
  assignee?: string | string[];
  allocation?: number | string;
  progress?: number | string;
  milestone?: boolean;
  children?: RawGanttTask[];
  [key: string]: any;
}

export interface RawGanttDoc {
  title?: string;
  colorBy?: 'phase' | 'assignee';
  calendar?: 'calendar' | 'workdays';
  columns?: string[] | string;
  'resource-allocation'?: boolean | string;
  resourceAllocation?: boolean | string;
  axis?: 'all' | 'mondays' | 'start-of-month' | string;
  tasks?: RawGanttTask[];
  [key: string]: any;
}

export interface ResolvedGanttTask {
  id: string;
  name: string;
  parentId: string | null;
  wbs: string;
  depth: number;
  isParent: boolean;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  durationDays: number;
  progress: number; // 0.0 to 1.0
  assignees: string[];
  assigneeAllocations?: Record<string, number>;
  displayAssignee: string;
  milestone: boolean;
  phaseId: string;
  phaseName: string;
  dependencies: string[];
  spans?: GanttTaskSpan[];
}

export interface GanttDependencyLink {
  source: string;
  target: string;
}

export interface GanttParsedModel {
  title?: string;
  width?: string | number;
  colorBy: 'phase' | 'assignee';
  calendar: 'calendar' | 'workdays';
  columns: string[];
  showResourceAllocation: boolean;
  axisInterval: 'all' | 'mondays' | 'start-of-month' | 'auto';
  tasks: ResolvedGanttTask[];
  links: GanttDependencyLink[];
  minDate: string;
  maxDate: string;
  assignees: string[];
  phases: string[];
  errors: string[];
}

/**
 * Parses a duration string (e.g. "5d", "2w", "1m", "0d") into number of calendar days.
 */
export function parseDuration(durationVal: string | number | undefined): number {
  if (durationVal === undefined || durationVal === null) return 1;
  if (typeof durationVal === 'number') return Math.max(0, durationVal);

  const clean = durationVal.trim().toLowerCase();
  if (!clean) return 1;

  if (clean === '0' || clean === '0d') return 0;

  const match = clean.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-z]*)$/);
  if (!match) {
    const num = parseFloat(clean);
    return isNaN(num) ? 1 : Math.max(0, num);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'w':
    case 'wk':
    case 'weeks':
    case 'week':
      return value * 7;
    case 'm':
    case 'mo':
    case 'month':
    case 'months':
      return value * 30.4375; // average month length
    case 'h':
    case 'hr':
    case 'hours':
      return value / 24;
    case 'd':
    case 'day':
    case 'days':
    default:
      return value;
  }
}

/**
 * Parses progress percentage or decimal (e.g. "75%", 0.75, 75).
 */
export function parseProgress(val: string | number | undefined): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') {
    if (val > 1) return Math.min(1, Math.max(0, val / 100));
    return Math.min(1, Math.max(0, val));
  }
  const clean = val.trim();
  if (clean.endsWith('%')) {
    const num = parseFloat(clean.slice(0, -1));
    return isNaN(num) ? 0 : Math.min(1, Math.max(0, num / 100));
  }
  const num = parseFloat(clean);
  if (isNaN(num)) return 0;
  if (num > 1) return Math.min(1, Math.max(0, num / 100));
  return Math.min(1, Math.max(0, num));
}

/**
 * Normalizes date to YYYY-MM-DD string.
 */
export function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a date string safely into a Date object at UTC midnight.
 */
export function parseDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d);
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Adds days to a date, optionally skipping weekends if workdaysOnly is true.
 */
export function addDays(start: Date, days: number, workdaysOnly: boolean = false): Date {
  const result = new Date(start.getTime());
  if (!workdaysOnly) {
    result.setDate(result.getDate() + Math.round(days));
    return result;
  }

  let remaining = Math.round(days);
  const step = remaining >= 0 ? 1 : -1;
  while (remaining !== 0) {
    result.setDate(result.getDate() + step);
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remaining -= step;
    }
  }
  return result;
}

/**
 * Parses multiple spans/intervals for a task from various YAML configurations:
 * - spans: [{ start, end }, { start, duration }]
 * - spans: [[start, end], [start, end]]
 * - spans: ['start to end', 'start -> end']
 * - start: [d1, d2], end: [d1, d2]
 * - start: "d1, d2", end: "d1, d2"
 * - dates: ...
 */
export function parseSpans(rawT: any, isWorkdays: boolean = false): GanttTaskSpan[] {
  if (!rawT || typeof rawT !== 'object') return [];
  const rawSpans = rawT.spans ?? rawT.dates;
  const parsed: GanttTaskSpan[] = [];

  if (Array.isArray(rawSpans) && rawSpans.length > 0) {
    for (const item of rawSpans) {
      if (!item) continue;
      if (typeof item === 'object' && !Array.isArray(item)) {
        const sStart = item.start ? String(item.start).trim() : '';
        const sEnd = item.end ? String(item.end).trim() : '';
        const sDur = item.duration !== undefined ? parseDuration(item.duration) : undefined;
        if (sStart && sEnd) {
          const d1 = parseDate(sStart);
          const d2 = parseDate(sEnd);
          const startD = d1.getTime() <= d2.getTime() ? d1 : d2;
          const endD = d1.getTime() <= d2.getTime() ? d2 : d1;
          const durationDays =
            sDur !== undefined
              ? sDur
              : Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000));
          parsed.push({
            start: formatDate(startD),
            end: formatDate(endD),
            durationDays,
          });
        } else if (sStart && sDur !== undefined) {
          const startD = parseDate(sStart);
          const endD = addDays(startD, sDur, isWorkdays);
          parsed.push({
            start: formatDate(startD),
            end: formatDate(endD),
            durationDays: sDur,
          });
        }
      } else if (Array.isArray(item) && item.length >= 2) {
        const sStart = String(item[0]).trim();
        const sEnd = String(item[1]).trim();
        if (sStart && sEnd) {
          const d1 = parseDate(sStart);
          const d2 = parseDate(sEnd);
          const startD = d1.getTime() <= d2.getTime() ? d1 : d2;
          const endD = d1.getTime() <= d2.getTime() ? d2 : d1;
          const sDur = item[2] !== undefined ? parseDuration(item[2]) : undefined;
          const durationDays =
            sDur !== undefined
              ? sDur
              : Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000));
          parsed.push({
            start: formatDate(startD),
            end: formatDate(endD),
            durationDays,
          });
        }
      } else if (typeof item === 'string') {
        const parts = item.split(/\s*(?:->|to|\/|,)\s*/);
        if (parts.length >= 2) {
          const d1 = parseDate(parts[0].trim());
          const d2 = parseDate(parts[1].trim());
          const startD = d1.getTime() <= d2.getTime() ? d1 : d2;
          const endD = d1.getTime() <= d2.getTime() ? d2 : d1;
          parsed.push({
            start: formatDate(startD),
            end: formatDate(endD),
            durationDays: Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000)),
          });
        }
      }
    }
  }

  // Also support start / end as arrays or comma-delimited strings
  if (parsed.length === 0) {
    const rawStarts = Array.isArray(rawT.start)
      ? rawT.start
      : typeof rawT.start === 'string' && rawT.start.includes(',')
      ? rawT.start.split(',')
      : [];
    const rawEnds = Array.isArray(rawT.end)
      ? rawT.end
      : typeof rawT.end === 'string' && rawT.end.includes(',')
      ? rawT.end.split(',')
      : [];

    if (rawStarts.length > 1 || rawEnds.length > 1) {
      const count = Math.max(rawStarts.length, rawEnds.length);
      for (let i = 0; i < count; i++) {
        const sStart = rawStarts[i] ? String(rawStarts[i]).trim() : '';
        const sEnd = rawEnds[i] ? String(rawEnds[i]).trim() : '';
        if (sStart && sEnd) {
          const d1 = parseDate(sStart);
          const d2 = parseDate(sEnd);
          const startD = d1.getTime() <= d2.getTime() ? d1 : d2;
          const endD = d1.getTime() <= d2.getTime() ? d2 : d1;
          parsed.push({
            start: formatDate(startD),
            end: formatDate(endD),
            durationDays: Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000)),
          });
        }
      }
    }
  }

  if (parsed.length === 0) return [];

  // Sort chronologically by start date
  parsed.sort((a, b) => a.start.localeCompare(b.start));

  // Merge overlapping or adjacent spans
  const merged: GanttTaskSpan[] = [parsed[0]];
  for (let i = 1; i < parsed.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = parsed[i];
    if (cur.start <= prev.end) {
      const newEnd = cur.end > prev.end ? cur.end : prev.end;
      prev.end = newEnd;
      prev.durationDays = Math.max(
        1,
        Math.round((parseDate(prev.end).getTime() - parseDate(prev.start).getTime()) / 86400000)
      );
    } else {
      merged.push(cur);
    }
  }

  return merged;
}

interface IntermediateTask {
  id: string;
  name: string;
  parentId: string | null;
  wbs: string;
  depth: number;
  hasChildren: boolean;
  explicitStart?: string;
  explicitEnd?: string;
  durationDays: number;
  progress: number;
  assignees: string[];
  assigneeAllocations?: Record<string, number>;
  displayAssignee: string;
  milestone: boolean;
  phaseId: string;
  phaseName: string;
  dependencies: { id: string; lagDays: number }[];
  spans?: GanttTaskSpan[];
}

/**
 * Preprocesses raw Gantt YAML to allow natural user syntax like unquoted `@mentions`.
 */
function preprocessGanttYaml(source: string): string {
  // Auto-quote unquoted @mentions (including optional allocation % like "@pasc (50%)")
  return source.replace(/(^|[\s,\[])@([a-zA-Z0-9_\-\.]+(?:\s*\([^)]*\)|\s*[0-9]+%?)?)/g, '$1"@$2"');
}

/**
 * Detects whether a parsed task entry is empty (e.g. null from an empty '-' in YAML,
 * an empty object '{}', or an object where all values are empty/null).
 */
export function isEmptyTask(t: any): boolean {
  if (t === null || t === undefined) return true;
  if (typeof t === 'string') return t.trim() === '';
  if (typeof t !== 'object') return true;
  const keys = Object.keys(t);
  if (keys.length === 0) return true;
  return keys.every((k) => {
    const val = t[k];
    return val === null || val === undefined || (typeof val === 'string' && val.trim() === '');
  });
}

/**
 * Parses raw Gantt markdown/YAML code into a fully scheduled, validated Gantt model.
 */
export function parseGanttMarkdown(yamlSource: string): GanttParsedModel {
  const errors: string[] = [];

  try {
    let rawDoc: any;
    try {
      const cleanedYaml = preprocessGanttYaml(yamlSource);
      rawDoc = parseYaml(cleanedYaml) || {};
    } catch (e: any) {
      return {
        title: 'Invalid Gantt Chart',
        colorBy: 'phase',
        calendar: 'calendar',
        columns: ['name'],
        showResourceAllocation: false,
        axisInterval: 'auto',
        tasks: [],
        links: [],
        minDate: formatDate(new Date()),
        maxDate: formatDate(new Date()),
        assignees: [],
        phases: [],
        errors: [`YAML Syntax Error: ${e?.message || 'Failed to parse'}`],
      };
    }

    if (!rawDoc || typeof rawDoc !== 'object') {
      rawDoc = {};
    }

    const title = typeof rawDoc.title === 'string' ? rawDoc.title : undefined;
  const colorBy: 'phase' | 'assignee' =
    rawDoc.colorBy === 'assignee' ? 'assignee' : 'phase';
  const calendar: 'calendar' | 'workdays' =
    rawDoc.calendar === 'workdays' ? 'workdays' : 'calendar';
  const isWorkdays = calendar === 'workdays';

  // Parse columns
  let columns: string[] = ['name'];
  const rawCols = rawDoc.columns;
  if (Array.isArray(rawCols)) {
    const list = rawCols.map((c: any) => String(c).trim().toLowerCase()).filter(Boolean);
    if (!list.includes('name') && !list.includes('task')) {
      columns = ['name', ...list];
    } else {
      columns = list.map((c: string) => (c === 'task' ? 'name' : c));
    }
  } else if (typeof rawCols === 'string' && rawCols.trim()) {
    const list = rawCols
      .split(/[,;\s]+/)
      .map((c: string) => c.trim().toLowerCase())
      .filter(Boolean);
    if (!list.includes('name') && !list.includes('task')) {
      columns = ['name', ...list];
    } else {
      columns = list.map((c: string) => (c === 'task' ? 'name' : c));
    }
  }

  // Parse resource-allocation
  const rawResourceAlloc =
    rawDoc['resource-allocation'] ??
    rawDoc['resourceAllocation'] ??
    rawDoc['resource_allocation'] ??
    rawDoc['resources'];
  const showResourceAllocation =
    rawResourceAlloc === true ||
    rawResourceAlloc === 'yes' ||
    rawResourceAlloc === 'true' ||
    rawResourceAlloc === '1';

  // Parse axis
  const rawAxis = (rawDoc.axis ?? rawDoc['date-axis'] ?? rawDoc['dateAxis'] ?? 'auto')
    .toString()
    .toLowerCase()
    .trim();
  let axisInterval: 'all' | 'mondays' | 'start-of-month' | 'auto' = 'auto';
  if (rawAxis === 'mondays' || rawAxis === 'monday' || rawAxis === 'week' || rawAxis === 'weekly') {
    axisInterval = 'mondays';
  } else if (
    rawAxis === 'start-of-month' ||
    rawAxis === 'start_of_month' ||
    rawAxis === 'month' ||
    rawAxis === 'monthly'
  ) {
    axisInterval = 'start-of-month';
  } else if (rawAxis === 'all' || rawAxis === 'day' || rawAxis === 'daily') {
    axisInterval = 'all';
  }

  // Parse width / timeline-width
  const rawWidth =
    rawDoc.width ??
    rawDoc['timeline-width'] ??
    rawDoc['timelineWidth'] ??
    rawDoc['timeline_width'];
  let widthConfig: string | number | undefined = undefined;
  if (typeof rawWidth === 'number' && rawWidth > 0) {
    widthConfig = rawWidth;
  } else if (typeof rawWidth === 'string' && rawWidth.trim()) {
    const cleanW = rawWidth.trim().toLowerCase();
    if (/^[0-9]+(?:\.[0-9]+)?(?:px)?$/.test(cleanW)) {
      const num = parseFloat(cleanW);
      if (!isNaN(num) && num > 0) widthConfig = Math.round(num);
    } else {
      widthConfig = cleanW;
    }
  }

  const rawTasks: RawGanttTask[] = Array.isArray(rawDoc)
    ? rawDoc
    : Array.isArray(rawDoc.tasks)
    ? rawDoc.tasks
    : [];

  if (rawTasks.length === 0) {
    return {
      title,
      width: widthConfig,
      colorBy,
      calendar,
      columns,
      showResourceAllocation,
      axisInterval,
      tasks: [],
      links: [],
      minDate: formatDate(new Date()),
      maxDate: formatDate(new Date()),
      assignees: [],
      phases: [],
      errors: ['No tasks defined in Gantt specification'],
    };
  }

  const intermediateList: IntermediateTask[] = [];
  const idSet = new Set<string>();

  // 1. Flatten hierarchy and normalize IDs, assignees, durations
  function flatten(
    tasks: any[],
    parentId: string | null,
    parentWbs: string,
    depth: number,
    currentPhaseId: string,
    currentPhaseName: string
  ) {
    tasks.forEach((rawT, idx) => {
      const wbs = parentWbs ? `${parentWbs}.${idx + 1}` : `${idx + 1}`;
      if (isEmptyTask(rawT)) {
        errors.push(`Empty task definition at item ${wbs}: unexpected empty item after "-"`);
        return;
      }

      const t: RawGanttTask = typeof rawT === 'string' ? { name: (rawT as string).trim() } : rawT;
      let id = t.id ? String(t.id).trim() : `task-${wbs.replace(/\./g, '_')}`;
      if (idSet.has(id)) {
        errors.push(`Duplicate task ID '${id}'. Renaming to '${id}_${idx}'`);
        id = `${id}_${idx}`;
      }
      idSet.add(id);

      const hasChildren =
        Array.isArray(t.children) &&
        t.children.some((c) => !isEmptyTask(c));
      const isMilestone = Boolean(t.milestone) || t.duration === '0' || t.duration === '0d' || t.duration === 0;

      // Extract assignees and allocations
      let defaultAlloc = 1.0;
      if (t.allocation !== undefined && t.allocation !== null) {
        if (typeof t.allocation === 'string' && t.allocation.endsWith('%')) {
          defaultAlloc = parseFloat(t.allocation) / 100;
        } else if (typeof t.allocation === 'number') {
          defaultAlloc = t.allocation > 1 ? t.allocation / 100 : t.allocation;
        } else {
          const num = parseFloat(String(t.allocation));
          if (!isNaN(num)) defaultAlloc = num > 1 ? num / 100 : num;
        }
      }

      const rawAssignees: string[] = [];
      if (typeof t.assignee === 'string') {
        rawAssignees.push(t.assignee);
      } else if (Array.isArray(t.assignee)) {
        t.assignee.forEach((a) => {
          if (typeof a === 'string') rawAssignees.push(a);
        });
      }

      const assignees: string[] = [];
      const assigneeAllocations: Record<string, number> = {};

      for (const a of rawAssignees) {
        const cleanA = a.trim();
        const match = cleanA.match(/^@?([a-zA-Z0-9_.-]+)(?:[\s:(]+([0-9]+(?:\.[0-9]+)?)\s*%\)?)?$/);
        if (match) {
          const username = match[1];
          let alloc = defaultAlloc;
          if (match[2]) {
            alloc = parseFloat(match[2]) / 100;
          }
          assignees.push(username);
          assigneeAllocations[username] = alloc;
        } else {
          const username = cleanA.startsWith('@') ? cleanA.slice(1) : cleanA;
          assignees.push(username);
          assigneeAllocations[username] = defaultAlloc;
        }
      }

      const displayAssignee = rawAssignees.join(', ');

      // Sort task assignees alphabetically
      assignees.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
      );

      const spans = isMilestone ? [] : parseSpans(t, isWorkdays);
      const hasSpans = spans.length >= 2;

      let explicitStart = t.start
        ? (Array.isArray(t.start) ? String(t.start[0]).trim() : String(t.start).trim())
        : undefined;
      let explicitEnd = t.end
        ? (Array.isArray(t.end) ? String(t.end[t.end.length - 1]).trim() : String(t.end).trim())
        : undefined;
      let durationDays = isMilestone ? 0 : parseDuration(t.duration);

      if (hasSpans) {
        explicitStart = spans[0].start;
        explicitEnd = spans[spans.length - 1].end;
        durationDays = spans.reduce((sum, s) => sum + s.durationDays, 0);
      }

      // Parse dependencies (supports 'depends-on' and legacy 'dependsOn')
      const depField = t['depends-on'] ?? t.dependsOn;
      const dependencies: { id: string; lagDays: number }[] = [];
      const rawDeps = Array.isArray(depField)
        ? depField
        : typeof depField === 'string'
        ? [depField]
        : [];

      for (const dep of rawDeps) {
        if (!dep || typeof dep !== 'string') continue;
        const depStr = dep.trim();
        const lagMatch = depStr.match(/^(.*?)\s*([+-]\s*[0-9]+(?:\.[0-9]+)?(?:d|w|days?|weeks?)?)$/i);
        if (lagMatch && lagMatch[1].trim()) {
          const targetId = lagMatch[1].trim();
          let lagDays = 0;
          if (lagMatch[2]) {
            const lagPart = lagMatch[2].replace(/\s+/g, '');
            const sign = lagPart.startsWith('-') ? -1 : 1;
            const unsigned = lagPart.replace(/^[+-]/, '');
            lagDays = sign * parseDuration(unsigned);
          }
          dependencies.push({ id: targetId, lagDays });
        } else {
          dependencies.push({ id: depStr, lagDays: 0 });
        }
      }

      const phaseId = depth === 0 ? id : currentPhaseId;
      const phaseName = depth === 0 ? t.name : currentPhaseName;

      intermediateList.push({
        id,
        name: t.name || `Task ${wbs}`,
        parentId,
        wbs,
        depth,
        hasChildren,
        explicitStart,
        explicitEnd,
        durationDays,
        progress: parseProgress(t.progress),
        assignees,
        assigneeAllocations,
        displayAssignee,
        milestone: isMilestone,
        phaseId,
        phaseName,
        dependencies,
        spans: hasSpans ? spans : undefined,
      });

      if (Array.isArray(t.children) && t.children.length > 0) {
        flatten(t.children, id, wbs, depth + 1, phaseId, phaseName);
      }
    });
  }

  flatten(rawTasks, null, '', 0, '', '');

  if (intermediateList.length === 0) {
    if (errors.length === 0) {
      errors.push('No valid tasks defined in Gantt specification');
    }
    return {
      title,
      width: widthConfig,
      colorBy,
      calendar,
      columns,
      showResourceAllocation,
      axisInterval,
      tasks: [],
      links: [],
      minDate: formatDate(new Date()),
      maxDate: formatDate(new Date()),
      assignees: [],
      phases: [],
      errors,
    };
  }

  const taskMap = new Map<string, IntermediateTask>();
  intermediateList.forEach((t) => taskMap.set(t.id, t));

  function findTask(ref: string): IntermediateTask | undefined {
    if (taskMap.has(ref)) return taskMap.get(ref);
    const refLower = ref.toLowerCase().trim();
    return (
      taskMap.get(refLower) ||
      intermediateList.find(
        (t) => t.id.toLowerCase() === refLower || t.name.toLowerCase() === refLower
      )
    );
  }

  // 2. Schedule dates (Hierarchical & Topological resolution for dependencies and summary tasks)
  const resolvedDates = new Map<string, { start: Date; end: Date }>();
  const resolvedKickoffs = new Map<string, Date>();
  const resolvingTasks = new Set<string>();
  const resolvingKickoffs = new Set<string>();

  function addError(msg: string) {
    if (!errors.includes(msg)) {
      errors.push(msg);
    }
  }

  // Determine baseline project start date (earliest explicit start, or today if none specified)
  let projectBaseStart: Date | null = null;
  for (const t of intermediateList) {
    if (t.explicitStart) {
      const d = parseDate(t.explicitStart);
      if (!projectBaseStart || d.getTime() < projectBaseStart.getTime()) {
        projectBaseStart = d;
      }
    }
  }

  const defaultProjectStart = projectBaseStart || new Date();
  defaultProjectStart.setHours(0, 0, 0, 0);

  /**
   * Resolves the kickoff start date for a task (leaf or summary).
   * A summary task's kickoff is determined by its explicit start or predecessors.
   * Tasks inside a summary task without their own start or dependency inherit
   * the summary task's kickoff date.
   */
  function getKickoff(id: string): Date {
    const task = findTask(id);
    if (!task) return defaultProjectStart;
    const realId = task.id;

    if (resolvedKickoffs.has(realId)) {
      return resolvedKickoffs.get(realId)!;
    }

    if (resolvingKickoffs.has(realId)) {
      addError(`Circular dependency detected involving task '${realId}'`);
      return defaultProjectStart;
    }

    resolvingKickoffs.add(realId);

    let kickoff: Date | null = null;

    if (task.explicitStart) {
      kickoff = parseDate(task.explicitStart);
    }

    if (task.dependencies.length > 0) {
      let maxDepEnd: Date | null = null;
      for (const dep of task.dependencies) {
        const predDates = resolveTask(dep.id);
        const depEffectiveEnd = addDays(predDates.end, dep.lagDays, isWorkdays);
        if (!maxDepEnd || depEffectiveEnd.getTime() > maxDepEnd.getTime()) {
          maxDepEnd = depEffectiveEnd;
        }
      }
      if (maxDepEnd) {
        if (!kickoff || maxDepEnd.getTime() > kickoff.getTime()) {
          kickoff = maxDepEnd;
        }
      }
    }

    if (!kickoff) {
      if (task.parentId) {
        kickoff = getKickoff(task.parentId);
      } else {
        kickoff = defaultProjectStart;
      }
    }

    resolvingKickoffs.delete(realId);
    resolvedKickoffs.set(realId, kickoff);
    return kickoff;
  }

  /**
   * Resolves the start and end dates of a task.
   * If the task is a summary task (has children), it recursively resolves all of its
   * subtasks and rolls up its start date (min start of children) and completion date
   * (max end of children).
   * Any dependent task referencing a summary task will therefore wait until all subtasks
   * of the summary task have finished.
   */
  function resolveTask(id: string): { start: Date; end: Date } {
    const task = findTask(id);
    if (!task) {
      addError(`Predecessor task '${id}' not found`);
      return { start: defaultProjectStart, end: addDays(defaultProjectStart, 1, isWorkdays) };
    }
    const realId = task.id;
    if (resolvedDates.has(realId)) {
      return resolvedDates.get(realId)!;
    }

    if (resolvingTasks.has(realId)) {
      addError(`Circular dependency detected involving task '${realId}'`);
      const fallbackStart = task.explicitStart ? parseDate(task.explicitStart) : defaultProjectStart;
      const fallbackEnd = task.explicitEnd
        ? parseDate(task.explicitEnd)
        : addDays(fallbackStart, Math.max(1, task.durationDays), isWorkdays);
      return { start: fallbackStart, end: fallbackEnd };
    }

    resolvingTasks.add(realId);

    let result: { start: Date; end: Date };

    if (task.hasChildren) {
      const children = intermediateList.filter((t) => t.parentId === realId);
      if (children.length === 0) {
        const kickoff = getKickoff(realId);
        result = {
          start: kickoff,
          end: addDays(kickoff, Math.max(1, task.durationDays), isWorkdays),
        };
      } else {
        let minStart: Date | null = null;
        let maxEnd: Date | null = null;
        let totalDuration = 0;
        let weightedProgressSum = 0;

        for (const child of children) {
          const childDates = resolveTask(child.id);
          if (!minStart || childDates.start.getTime() < minStart.getTime()) {
            minStart = childDates.start;
          }
          if (!maxEnd || childDates.end.getTime() > maxEnd.getTime()) {
            maxEnd = childDates.end;
          }
          const dur = Math.max(1, child.durationDays);
          totalDuration += dur;
          weightedProgressSum += child.progress * dur;
        }

        const start = minStart || getKickoff(realId);
        const end = maxEnd || start;

        task.durationDays = Math.max(
          1,
          Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
        );
        task.progress = totalDuration > 0 ? weightedProgressSum / totalDuration : 0;

        result = { start, end };
      }
    } else if (task.spans && task.spans.length >= 2) {
      const startDate = parseDate(task.spans[0].start);
      const endDate = parseDate(task.spans[task.spans.length - 1].end);
      result = { start: startDate, end: endDate };
    } else {
      const startDate = getKickoff(realId);
      let endDate: Date;
      if (task.explicitEnd) {
        endDate = parseDate(task.explicitEnd);
        if (task.durationDays <= 1 && endDate.getTime() >= startDate.getTime()) {
          const diffDays = Math.max(
            1,
            Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
          );
          task.durationDays = diffDays;
        }
      } else if (task.milestone) {
        endDate = new Date(startDate.getTime());
      } else {
        endDate = addDays(startDate, task.durationDays, isWorkdays);
      }
      result = { start: startDate, end: endDate };
    }

    resolvingTasks.delete(realId);
    resolvedDates.set(realId, result);
    return result;
  }

  // Resolve all tasks
  for (const t of intermediateList) {
    resolveTask(t.id);
  }

  // 4. Construct resolved tasks & links
  const resolvedTasks: ResolvedGanttTask[] = [];
  const links: GanttDependencyLink[] = [];
  const assigneesSet = new Set<string>();
  const phasesSet = new Set<string>();

  let overallMin: Date | null = null;
  let overallMax: Date | null = null;

  for (const t of intermediateList) {
    const dates = resolvedDates.get(t.id) || {
      start: defaultProjectStart,
      end: addDays(defaultProjectStart, 1, isWorkdays),
    };

    if (!overallMin || dates.start.getTime() < overallMin.getTime()) {
      overallMin = dates.start;
    }
    if (!overallMax || dates.end.getTime() > overallMax.getTime()) {
      overallMax = dates.end;
    }

    t.assignees.forEach((a) => assigneesSet.add(a));
    if (t.phaseName) phasesSet.add(t.phaseName);

    for (const dep of t.dependencies) {
      const pred = findTask(dep.id);
      if (pred) {
        links.push({
          source: pred.id,
          target: t.id,
        });
      }
    }

    resolvedTasks.push({
      id: t.id,
      name: t.name,
      parentId: t.parentId,
      wbs: t.wbs,
      depth: t.depth,
      isParent: t.hasChildren,
      start: formatDate(dates.start),
      end: formatDate(dates.end),
      durationDays: t.durationDays,
      progress: Math.round(t.progress * 100) / 100,
      assignees: t.assignees,
      assigneeAllocations: t.assigneeAllocations,
      displayAssignee: t.displayAssignee,
      milestone: t.milestone,
      phaseId: t.phaseId,
      phaseName: t.phaseName,
      dependencies: t.dependencies.map((d) => d.id),
      spans: t.spans && t.spans.length >= 2 ? t.spans : undefined,
    });
  }

    return {
      title,
      width: widthConfig,
      colorBy,
      calendar,
      columns,
      showResourceAllocation,
      axisInterval,
      tasks: resolvedTasks,
      links,
      minDate: overallMin ? formatDate(overallMin) : formatDate(new Date()),
      maxDate: overallMax ? formatDate(overallMax) : formatDate(new Date()),
      assignees: Array.from(assigneesSet).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
      ),
      phases: Array.from(phasesSet),
      errors,
    };
  } catch (err: any) {
    return {
      title: 'Invalid Gantt Chart',
      colorBy: 'phase',
      calendar: 'calendar',
      columns: ['name'],
      showResourceAllocation: false,
      axisInterval: 'auto',
      tasks: [],
      links: [],
      minDate: formatDate(new Date()),
      maxDate: formatDate(new Date()),
      assignees: [],
      phases: [],
      errors: [`Error parsing Gantt specification: ${err?.message || 'Unknown error'}`],
    };
  }
}
