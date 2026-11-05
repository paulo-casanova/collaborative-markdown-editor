import { parse as parseYaml } from 'yaml';

export interface RawGanttTask {
  id?: string;
  name: string;
  start?: string;
  end?: string;
  duration?: string | number;
  dependsOn?: string | string[];
  assignee?: string | string[];
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
  displayAssignee: string;
  milestone: boolean;
  phaseId: string;
  phaseName: string;
  dependencies: string[];
}

export interface GanttDependencyLink {
  source: string;
  target: string;
}

export interface GanttParsedModel {
  title?: string;
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
  displayAssignee: string;
  milestone: boolean;
  phaseId: string;
  phaseName: string;
  dependencies: { id: string; lagDays: number }[];
}

/**
 * Preprocesses raw Gantt YAML to allow natural user syntax like unquoted `@mentions`.
 */
function preprocessGanttYaml(source: string): string {
  // Auto-quote unquoted @mentions (YAML 1.2 treats @ as reserved character)
  return source.replace(/(^|[\s,\[])@([a-zA-Z0-9_\-\.]+)/g, '$1"@$2"');
}

/**
 * Parses raw Gantt markdown/YAML code into a fully scheduled, validated Gantt model.
 */
export function parseGanttMarkdown(yamlSource: string): GanttParsedModel {
  const errors: string[] = [];

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

  const rawTasks: RawGanttTask[] = Array.isArray(rawDoc)
    ? rawDoc
    : Array.isArray(rawDoc.tasks)
    ? rawDoc.tasks
    : [];

  if (rawTasks.length === 0) {
    return {
      title,
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
    tasks: RawGanttTask[],
    parentId: string | null,
    parentWbs: string,
    depth: number,
    currentPhaseId: string,
    currentPhaseName: string
  ) {
    tasks.forEach((t, idx) => {
      const wbs = parentWbs ? `${parentWbs}.${idx + 1}` : `${idx + 1}`;
      let id = t.id ? String(t.id).trim() : `task-${wbs.replace(/\./g, '_')}`;
      if (idSet.has(id)) {
        errors.push(`Duplicate task ID '${id}'. Renaming to '${id}_${idx}'`);
        id = `${id}_${idx}`;
      }
      idSet.add(id);

      const hasChildren = Array.isArray(t.children) && t.children.length > 0;
      const isMilestone = Boolean(t.milestone) || t.duration === '0' || t.duration === '0d' || t.duration === 0;

      // Extract assignees (handles strings, arrays, @username)
      const rawAssignees: string[] = [];
      if (typeof t.assignee === 'string') {
        rawAssignees.push(t.assignee);
      } else if (Array.isArray(t.assignee)) {
        t.assignee.forEach((a) => {
          if (typeof a === 'string') rawAssignees.push(a);
        });
      }

      const assignees = rawAssignees.map((a) => {
        const clean = a.trim();
        return clean.startsWith('@') ? clean.slice(1) : clean;
      });

      const displayAssignee = rawAssignees.join(', ');

      // Parse dependencies
      const dependencies: { id: string; lagDays: number }[] = [];
      const rawDeps = Array.isArray(t.dependsOn)
        ? t.dependsOn
        : typeof t.dependsOn === 'string'
        ? [t.dependsOn]
        : [];

      for (const dep of rawDeps) {
        if (!dep || typeof dep !== 'string') continue;
        const depStr = dep.trim();
        const lagMatch = depStr.match(/^([a-zA-Z0-9_-]+)\s*([+-]\s*[0-9]+(?:\.[0-9]+)?[a-z]*)?$/);
        if (lagMatch) {
          const targetId = lagMatch[1];
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
        explicitStart: t.start ? String(t.start).trim() : undefined,
        explicitEnd: t.end ? String(t.end).trim() : undefined,
        durationDays: isMilestone ? 0 : parseDuration(t.duration),
        progress: parseProgress(t.progress),
        assignees,
        displayAssignee,
        milestone: isMilestone,
        phaseId,
        phaseName,
        dependencies,
      });

      if (hasChildren) {
        flatten(t.children!, id, wbs, depth + 1, phaseId, phaseName);
      }
    });
  }

  flatten(rawTasks, null, '', 0, '', '');

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

  // 2. Schedule dates (Topological resolution for dependencies)
  const resolvedDates = new Map<string, { start: Date; end: Date }>();
  const visiting = new Set<string>();
  const visited = new Set<string>();

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

  function resolveTask(id: string): { start: Date; end: Date } {
    const task = findTask(id);
    if (!task) {
      errors.push(`Predecessor task '${id}' not found`);
      return { start: defaultProjectStart, end: addDays(defaultProjectStart, 1, isWorkdays) };
    }
    const realId = task.id;
    if (resolvedDates.has(realId)) {
      return resolvedDates.get(realId)!;
    }

    if (visiting.has(realId)) {
      errors.push(`Circular dependency detected involving task '${realId}'`);
      const fallbackStart = task.explicitStart ? parseDate(task.explicitStart) : defaultProjectStart;
      const fallbackEnd = task.explicitEnd
        ? parseDate(task.explicitEnd)
        : addDays(fallbackStart, task.durationDays, isWorkdays);
      return { start: fallbackStart, end: fallbackEnd };
    }

    visiting.add(realId);

    let startDate: Date;
    if (task.explicitStart) {
      startDate = parseDate(task.explicitStart);
    } else if (task.dependencies.length > 0) {
      // Start is determined by maximum end date of predecessors
      let maxPredEnd: Date | null = null;
      for (const dep of task.dependencies) {
        const predDates = resolveTask(dep.id);
        const depEffectiveEnd = addDays(predDates.end, dep.lagDays, isWorkdays);
        if (!maxPredEnd || depEffectiveEnd.getTime() > maxPredEnd.getTime()) {
          maxPredEnd = depEffectiveEnd;
        }
      }
      startDate = maxPredEnd || defaultProjectStart;
    } else {
      startDate = defaultProjectStart;
    }

    let endDate: Date;
    if (task.explicitEnd) {
      endDate = parseDate(task.explicitEnd);
      // Auto-compute durationDays if not specified
      if (task.durationDays <= 1 && endDate.getTime() >= startDate.getTime()) {
        const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
        task.durationDays = diffDays;
      }
    } else if (task.milestone) {
      endDate = new Date(startDate.getTime());
    } else {
      endDate = addDays(startDate, task.durationDays, isWorkdays);
    }

    visiting.delete(realId);
    visited.add(realId);

    const result = { start: startDate, end: endDate };
    resolvedDates.set(realId, result);
    return result;
  }

  // Resolve leaf tasks first
  for (const t of intermediateList) {
    if (!t.hasChildren) {
      resolveTask(t.id);
    }
  }

  // 3. Roll up summary parent dates and progress from children
  function rollupParents(parentId: string | null) {
    const children = intermediateList.filter((t) => t.parentId === parentId);
    for (const child of children) {
      if (child.hasChildren) {
        rollupParents(child.id);
        const subChildren = intermediateList.filter((t) => t.parentId === child.id);
        if (subChildren.length > 0) {
          let minStart: Date | null = null;
          let maxEnd: Date | null = null;
          let totalDuration = 0;
          let weightedProgressSum = 0;

          for (const sc of subChildren) {
            const scDates = resolvedDates.get(sc.id);
            if (scDates) {
              if (!minStart || scDates.start.getTime() < minStart.getTime()) {
                minStart = scDates.start;
              }
              if (!maxEnd || scDates.end.getTime() > maxEnd.getTime()) {
                maxEnd = scDates.end;
              }
            }
            const dur = Math.max(1, sc.durationDays);
            totalDuration += dur;
            weightedProgressSum += sc.progress * dur;
          }

          if (minStart && maxEnd) {
            resolvedDates.set(child.id, { start: minStart, end: maxEnd });
            child.durationDays = Math.max(
              1,
              Math.round((maxEnd.getTime() - minStart.getTime()) / (1000 * 60 * 60 * 24))
            );
          }
          child.progress = totalDuration > 0 ? weightedProgressSum / totalDuration : 0;
        }
      }
    }
  }

  rollupParents(null);

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
      displayAssignee: t.displayAssignee,
      milestone: t.milestone,
      phaseId: t.phaseId,
      phaseName: t.phaseName,
      dependencies: t.dependencies.map((d) => d.id),
    });
  }

  return {
    title,
    colorBy,
    calendar,
    columns,
    showResourceAllocation,
    axisInterval,
    tasks: resolvedTasks,
    links,
    minDate: overallMin ? formatDate(overallMin) : formatDate(new Date()),
    maxDate: overallMax ? formatDate(overallMax) : formatDate(new Date()),
    assignees: Array.from(assigneesSet),
    phases: Array.from(phasesSet),
    errors,
  };
}
