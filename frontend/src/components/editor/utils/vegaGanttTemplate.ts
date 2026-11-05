import { parseDate, type GanttParsedModel, type ResolvedGanttTask } from '../../../utils/ganttParser';

export interface VegaGanttTheme {
  isDark: boolean;
  background: string;
  textColor: string;
  textMuted: string;
  gridColor: string;
  weekendColor: string;
  borderColor: string;
  primaryColor: string;
  progressColor: string;
  milestoneColor: string;
  dependencyColor: string;
  todayLineColor: string;
}

export function getGanttTheme(isDark: boolean): VegaGanttTheme {
  if (isDark) {
    return {
      isDark: true,
      background: 'transparent',
      textColor: '#f4f4f5',
      textMuted: '#a1a1aa',
      gridColor: '#27272a',
      weekendColor: 'rgba(255, 255, 255, 0.04)',
      borderColor: '#3f3f46',
      primaryColor: '#3b82f6',
      progressColor: '#2563eb',
      milestoneColor: '#f59e0b',
      dependencyColor: '#60a5fa',
      todayLineColor: '#ef4444',
    };
  }
  return {
    isDark: false,
    background: 'transparent',
    textColor: '#18181b',
    textMuted: '#71717a',
    gridColor: '#e4e4e7',
    weekendColor: 'rgba(0, 0, 0, 0.035)',
    borderColor: '#e2e8f0',
    primaryColor: '#2563eb',
    progressColor: '#1d4ed8',
    milestoneColor: '#d97706',
    dependencyColor: '#3b82f6',
    todayLineColor: '#ef4444',
  };
}

/**
 * Calculates all weekend (Saturday 00:00 to Monday 00:00) date spans between minDate and maxDate.
 */
export function getWeekendsBetween(
  minDateStr: string,
  maxDateStr: string
): { start: string; end: string }[] {
  const weekends: { start: string; end: string }[] = [];
  if (!minDateStr || !maxDateStr) return weekends;

  const cur = new Date(minDateStr + 'T00:00:00');
  const end = new Date(maxDateStr + 'T00:00:00');
  end.setDate(end.getDate() + 3);

  let iterations = 0;
  while (cur <= end && iterations < 365) {
    iterations++;
    if (cur.getDay() === 6) {
      // Saturday
      const sat = new Date(cur.getTime());
      const mon = new Date(cur.getTime());
      mon.setDate(mon.getDate() + 2); // Monday 00:00:00
      const satStr = sat.toISOString().split('T')[0];
      const monStr = mon.toISOString().split('T')[0];
      weekends.push({ start: satStr, end: monStr });
      cur.setDate(cur.getDate() + 2);
    } else {
      cur.setDate(cur.getDate() + 1);
    }
  }

  return weekends;
}

/**
 * Calculates tick timestamps and formatting based on axis mode: 'all' | 'mondays' | 'start-of-month' | 'auto'.
 */
export function getAxisTicks(
  minDateStr: string,
  maxDateStr: string,
  mode: 'all' | 'mondays' | 'start-of-month' | 'auto' = 'auto'
): { values?: number[]; format?: string } {
  if (!minDateStr || !maxDateStr) return {};

  const start = new Date(minDateStr + 'T00:00:00Z');
  const end = new Date(maxDateStr + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return {};

  const m = (mode || 'auto').toLowerCase().trim();

  if (m === 'mondays' || m === 'monday' || m === 'week' || m === 'weekly') {
    const values: number[] = [];
    const cur = new Date(start.getTime());
    while (cur <= end) {
      if (cur.getUTCDay() === 1) {
        values.push(cur.getTime());
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (values.length === 0) {
      values.push(start.getTime());
    }
    return { values, format: '%b %d (%a)' };
  }

  if (m === 'start-of-month' || m === 'start_of_month' || m === 'month' || m === 'monthly') {
    const values: number[] = [];
    const cur = new Date(start.getTime());
    cur.setUTCDate(1);
    while (cur <= end) {
      if (cur >= start) {
        values.push(cur.getTime());
      }
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    if (values.length === 0) {
      values.push(start.getTime());
    }
    return { values, format: '%b %Y' };
  }

  if (m === 'all' || m === 'day' || m === 'daily') {
    const values: number[] = [];
    const cur = new Date(start.getTime());
    while (cur <= end) {
      values.push(cur.getTime());
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return { values, format: '%b %d' };
  }

  // 'auto': Select based on duration in days
  const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 21) {
    return getAxisTicks(minDateStr, maxDateStr, 'all');
  }
  if (diffDays <= 90) {
    return getAxisTicks(minDateStr, maxDateStr, 'mondays');
  }
  return getAxisTicks(minDateStr, maxDateStr, 'start-of-month');
}

export interface ResourceIntervalChunk {
  start: string;
  end: string;
  taskCount: number;
  totalAlloc: number;
  allocationText: string;
  workloadText: string;
  taskNames: string;
  durationDays: number;
  fillColor: string;
  strokeColor: string;
}

/**
 * Computes contiguous intervals of uniform workload/allocation for a resource.
 * Splits into chunks wherever the number of active tasks or total allocation changes.
 */
export function computeResourceIntervals(
  assignedTasks: ResolvedGanttTask[],
  resource: string
): ResourceIntervalChunk[] {
  // Filter out parent rollups and zero-duration milestones
  const activeTasks = assignedTasks.filter(
    (t) => !t.isParent && !t.milestone && t.start < t.end
  );

  if (activeTasks.length === 0) return [];

  // Check if any task explicitly specified fractional allocation
  const hasExplicitAlloc = activeTasks.some((t) => {
    const alloc = t.assigneeAllocations?.[resource];
    return alloc !== undefined && alloc !== 1.0;
  });

  // Collect all unique boundary dates
  const dateSet = new Set<string>();
  for (const t of activeTasks) {
    dateSet.add(t.start);
    dateSet.add(t.end);
  }

  const sortedDates = Array.from(dateSet).sort();
  if (sortedDates.length < 2) return [];

  // Build atomic intervals between consecutive boundary dates
  interface RawInterval {
    start: string;
    end: string;
    taskCount: number;
    totalAlloc: number;
    tasks: ResolvedGanttTask[];
  }

  const rawIntervals: RawInterval[] = [];
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const dStart = sortedDates[i];
    const dEnd = sortedDates[i + 1];

    const currentTasks = activeTasks.filter(
      (t) => t.start <= dStart && t.end >= dEnd
    );

    if (currentTasks.length > 0) {
      let totalAlloc = 0;
      for (const t of currentTasks) {
        totalAlloc += t.assigneeAllocations?.[resource] ?? 1.0;
      }

      rawIntervals.push({
        start: dStart,
        end: dEnd,
        taskCount: currentTasks.length,
        totalAlloc,
        tasks: currentTasks,
      });
    }
  }

  if (rawIntervals.length === 0) return [];

  // Merge adjacent contiguous intervals where workload is identical
  const merged: RawInterval[] = [];
  let currentChunk: RawInterval = {
    start: rawIntervals[0].start,
    end: rawIntervals[0].end,
    taskCount: rawIntervals[0].taskCount,
    totalAlloc: rawIntervals[0].totalAlloc,
    tasks: [...rawIntervals[0].tasks],
  };

  for (let i = 1; i < rawIntervals.length; i++) {
    const next = rawIntervals[i];
    const isContiguous = currentChunk.end === next.start;
    const sameLoad = hasExplicitAlloc
      ? Math.abs(currentChunk.totalAlloc - next.totalAlloc) < 0.001
      : currentChunk.taskCount === next.taskCount;

    if (isContiguous && sameLoad) {
      currentChunk.end = next.end;
      for (const t of next.tasks) {
        if (!currentChunk.tasks.some((existing) => existing.id === t.id)) {
          currentChunk.tasks.push(t);
        }
      }
    } else {
      merged.push(currentChunk);
      currentChunk = {
        start: next.start,
        end: next.end,
        taskCount: next.taskCount,
        totalAlloc: next.totalAlloc,
        tasks: [...next.tasks],
      };
    }
  }
  merged.push(currentChunk);

  // Format into view data
  return merged.map((chunk) => {
    const allocationText = hasExplicitAlloc
      ? `${Math.round(chunk.totalAlloc * 100)}%`
      : `${chunk.taskCount}`;

    const workloadText = `${chunk.taskCount} task${chunk.taskCount === 1 ? '' : 's'}${
      chunk.taskCount > 1 ? ' (concurrent)' : ''
    }`;

    const taskNames = chunk.tasks.map((t) => t.name).join(', ');

    const sDate = parseDate(chunk.start);
    const eDate = parseDate(chunk.end);
    const durationDays = Math.max(
      1,
      Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    // Color coding by workload
    // 1 task / <= 100% -> Blue (#3b82f6)
    // 2 tasks / > 100% and <= 200% -> Amber (#f59e0b)
    // 3+ tasks / > 200% -> Red (#ef4444)
    let fillColor = '#3b82f6';
    let strokeColor = '#2563eb';

    const loadMetric = hasExplicitAlloc ? chunk.totalAlloc : chunk.taskCount;
    if (loadMetric > 1 && loadMetric <= 2) {
      fillColor = '#f59e0b';
      strokeColor = '#d97706';
    } else if (loadMetric > 2) {
      fillColor = '#ef4444';
      strokeColor = '#dc2626';
    }

    return {
      start: chunk.start,
      end: chunk.end,
      taskCount: chunk.taskCount,
      totalAlloc: chunk.totalAlloc,
      allocationText,
      workloadText,
      taskNames,
      durationDays,
      fillColor,
      strokeColor,
    };
  });
}

export interface VegaGanttSpecOptions {
  isDark?: boolean;
  mode?: 'all' | 'table' | 'timeline';
  timelineWidth?: number;
}

/**
 * Calculates the width of the Gantt timeline.
 * If model.width is specified as a number, it uses that number.
 * If model.width is 'auto' / 'as-needed' / 'scroll' / 'expand', it computes an expanded width
 * proportional to the project duration so bars have ample room and can be scrolled horizontally.
 * Otherwise, if containerWidth is available, it sizes to fit the reading column.
 */
export function calculateTimelineWidth(
  model: GanttParsedModel,
  containerWidth?: number,
  totalTableWidth: number = 300
): number {
  const w = model.width;

  // Explicit pixel width
  if (typeof w === 'number' && w > 0) {
    return Math.max(300, w);
  }

  // String number like "1200" or "1200px"
  if (typeof w === 'string' && /^[0-9]+/.test(w)) {
    const num = parseInt(w, 10);
    if (!isNaN(num) && num > 0) return Math.max(300, num);
  }

  // 'auto' / 'as-needed' / 'scroll' / 'expand' / 'max'
  const isAsNeeded =
    w === 'auto' ||
    w === 'as-needed' ||
    w === 'as_needed' ||
    w === 'scroll' ||
    w === 'expand' ||
    w === 'max';

  if (isAsNeeded) {
    const sDate = model.minDate ? parseDate(model.minDate) : new Date();
    const eDate = model.maxDate ? parseDate(model.maxDate) : new Date();
    const diffDays = Math.max(
      7,
      Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    const pxPerDay =
      diffDays <= 14 ? 50 : diffDays <= 45 ? 35 : diffDays <= 90 ? 25 : diffDays <= 180 ? 18 : 12;

    return Math.max(800, Math.min(4000, Math.round(diffDays * pxPerDay)));
  }

  // Default / 'fit':
  if (containerWidth && containerWidth > totalTableWidth + 100) {
    return Math.max(500, containerWidth - totalTableWidth - 40);
  }

  return 600;
}

/**
 * Builds a complete, standalone Vega specification for the hierarchical Gantt chart.
 * Supports mode: 'all' (unified spec), 'table' (frozen left table only), or 'timeline' (scrollable right timeline only).
 */
export function buildVegaGanttSpec(
  model: GanttParsedModel,
  isDarkOrOptions: boolean | VegaGanttSpecOptions = false,
  legacyMode?: 'all' | 'table' | 'timeline',
  legacyTimelineWidth?: number
): any {
  const options: VegaGanttSpecOptions =
    typeof isDarkOrOptions === 'boolean'
      ? { isDark: isDarkOrOptions, mode: legacyMode || 'all', timelineWidth: legacyTimelineWidth }
      : isDarkOrOptions || {};

  const isDark = Boolean(options.isDark);
  const mode: 'all' | 'table' | 'timeline' = options.mode || 'all';
  const theme = getGanttTheme(isDark);

  const rowHeight = 36;
  const headerHeight = 45;

  // 1. Column configuration
  const maxLabelLen = Math.max(
    8,
    ...model.tasks.map((t) => (t.wbs ? `${t.wbs} ` : '').length + t.name.length + t.depth * 2)
  );
  const nameWidth = Math.min(260, Math.max(120, Math.round(maxLabelLen * 7.5 + 20)));

  interface TableCol {
    key: string;
    title: string;
    width: number;
    align: 'left' | 'center' | 'right';
  }

  const rawColList = model.columns && model.columns.length > 0 ? model.columns : ['name'];
  const colConfigs: TableCol[] = [];

  for (const rawCol of rawColList) {
    const k = rawCol.toLowerCase().replace(/[-_]/g, '');
    if (k === 'name' || k === 'task') {
      colConfigs.push({ key: 'name', title: 'Task / Milestone', width: nameWidth, align: 'left' });
    } else if (k === 'start' || k === 'startdate') {
      colConfigs.push({ key: 'start', title: 'Start', width: 85, align: 'center' });
    } else if (k === 'end' || k === 'enddate') {
      colConfigs.push({ key: 'end', title: 'End', width: 85, align: 'center' });
    } else if (k === 'duration' || k === 'dur') {
      colConfigs.push({ key: 'duration', title: 'Dur', width: 55, align: 'right' });
    } else if (k === 'progress' || k === 'prog') {
      colConfigs.push({ key: 'progress', title: 'Progress', width: 65, align: 'right' });
    } else if (k === 'assignee' || k === 'assignees' || k === 'resource' || k === 'resources') {
      colConfigs.push({ key: 'assignee', title: 'Assignee', width: 95, align: 'left' });
    }
  }

  if (!colConfigs.some((c) => c.key === 'name')) {
    colConfigs.unshift({ key: 'name', title: 'Task / Milestone', width: nameWidth, align: 'left' });
  }

  const totalTableWidth = colConfigs.reduce((acc, c) => acc + c.width, 0);

  let currentX = mode === 'table' ? 0 : -totalTableWidth;
  const columnsWithPos = colConfigs.map((col) => {
    const left = currentX;
    const right = currentX + col.width;
    currentX = right;
    return {
      ...col,
      left,
      right,
    };
  });

  const effectiveTimelineWidth =
    options.timelineWidth || calculateTimelineWidth(model, undefined, totalTableWidth);
  const rowCount = Math.max(1, model.tasks.length);
  const taskChartHeight = rowCount * rowHeight;

  // 2. Resource Allocation configuration
  const showResourceAllocation = Boolean(model.showResourceAllocation && model.assignees.length > 0);
  const resourceGap = showResourceAllocation ? 38 : 0;
  const resourceRowHeight = 32;
  const resourceSectionY = taskChartHeight + resourceGap;
  const resourceCount = showResourceAllocation ? model.assignees.length : 0;
  const totalChartHeight =
    taskChartHeight + (showResourceAllocation ? resourceGap + resourceCount * resourceRowHeight : 0);

  const resourceRowsData: any[] = [];
  const resourceTasksData: any[] = [];

  if (showResourceAllocation) {
    model.assignees.forEach((resource, rIndex) => {
      const assignedTasks = model.tasks.filter((t) => t.assignees.includes(resource));
      const leafTasks = assignedTasks.filter((t) => !t.isParent);
      const yTop = resourceSectionY + rIndex * resourceRowHeight + 5;
      const yCenter = resourceSectionY + rIndex * resourceRowHeight + resourceRowHeight / 2;
      const barHeight = resourceRowHeight - 10;

      resourceRowsData.push({
        resource,
        displayResource: resource.startsWith('@') ? resource : `@${resource}`,
        taskCount: leafTasks.length,
        taskCountText: `${leafTasks.length} task${leafTasks.length === 1 ? '' : 's'}`,
        index: rIndex,
        rowIndex: rowCount + rIndex,
        yTop: resourceSectionY + rIndex * resourceRowHeight,
        yCenter,
        height: resourceRowHeight,
      });

      const intervals = computeResourceIntervals(assignedTasks, resource);
      for (const chunk of intervals) {
        resourceTasksData.push({
          resource,
          displayResource: resource.startsWith('@') ? resource : `@${resource}`,
          start: chunk.start,
          end: chunk.end,
          taskCount: chunk.taskCount,
          totalAlloc: chunk.totalAlloc,
          allocationText: chunk.allocationText,
          workloadText: chunk.workloadText,
          taskNames: chunk.taskNames,
          durationDays: chunk.durationDays,
          fillColor: chunk.fillColor,
          strokeColor: chunk.strokeColor,
          colorKey: resource,
          yTop,
          yCenter,
          barHeight,
        });
      }
    });
  }

  // 3. Compute tasks dataset with row coordinates
  const tasksData = model.tasks.map((t, index) => {
    const yCenter = index * rowHeight + rowHeight / 2;
    const yTop = index * rowHeight + 6;
    const barHeight = rowHeight - 12;

    return {
      ...t,
      index,
      yCenter,
      yTop,
      barHeight,
      progressWidthPct: t.progress,
      labelX: 8 + t.depth * 14,
      displayAssigneeText: t.displayAssignee ? `[${t.displayAssignee}]` : '',
    };
  });

  const taskIndexMap = new Map<string, typeof tasksData[0]>();
  tasksData.forEach((t) => taskIndexMap.set(t.id, t));

  // Compute dependency connector links
  const linksData: any[] = [];
  for (const link of model.links) {
    const sourceTask = taskIndexMap.get(link.source);
    const targetTask = taskIndexMap.get(link.target);
    if (sourceTask && targetTask) {
      linksData.push({
        sourceId: link.source,
        targetId: link.target,
        sourceEnd: sourceTask.end,
        sourceY: sourceTask.yCenter,
        targetStart: targetTask.start,
        targetY: targetTask.yCenter,
      });
    }
  }

  // Weekends dataset for shading
  const weekendsData = getWeekendsBetween(model.minDate, model.maxDate);

  // Assignee / Phase color palette
  const colorField = model.colorBy === 'assignee' ? 'assigneeKey' : 'phaseKey';
  const colorData = tasksData.map((t) => ({
    ...t,
    assigneeKey: t.assignees[0] || 'Unassigned',
    phaseKey: t.phaseName || 'General',
  }));

  // Only show the today line if today is within the active project date range
  const todayStr = new Date().toISOString().split('T')[0];
  const isTodayInRange = todayStr >= model.minDate && todayStr <= model.maxDate;
  const todayValues = isTodayInRange ? [{ date: todayStr }] : [];

  // Axis ticks based on user selection
  const axisTicks = getAxisTicks(model.minDate, model.maxDate, model.axisInterval);

  // Dynamic marks generation for table columns
  const tableMarks: any[] = [];

  if (mode === 'all' || mode === 'table') {
    // Top header bottom dividing line in table mode
    if (mode === 'table') {
      tableMarks.push({
        type: 'rule',
        encode: {
          enter: {
            x: { value: 0 },
            x2: { value: totalTableWidth },
            y: { value: 0 },
            stroke: { value: theme.borderColor },
            strokeWidth: { value: 1 },
          },
        },
      });

      // Right boundary divider separating table from timeline
      tableMarks.push({
        type: 'rule',
        encode: {
          enter: {
            x: { value: totalTableWidth },
            y: { value: 0 },
            y2: { value: totalChartHeight },
            stroke: { value: theme.borderColor },
            strokeWidth: { value: 1 },
          },
        },
      });
    }

    // Subtle vertical column dividers
    columnsWithPos.forEach((col, idx) => {
      if (idx < columnsWithPos.length - 1) {
        tableMarks.push({
          type: 'rule',
          encode: {
            enter: {
              x: { value: col.right },
              y: { value: -22 },
              y2: { value: taskChartHeight },
              stroke: { value: theme.borderColor },
              strokeWidth: { value: 1 },
              opacity: { value: 0.4 },
            },
          },
        });
      }
    });

    // Table Column Headers
    columnsWithPos.forEach((col) => {
      const headerX =
        col.align === 'center'
          ? col.left + col.width / 2
          : col.align === 'right'
          ? col.right - 8
          : col.left + 8;

      tableMarks.push({
        type: 'text',
        encode: {
          enter: {
            x: { value: headerX },
            y: { value: -14 },
            text: { value: col.title },
            fontSize: { value: 11 },
            fontWeight: { value: 'bold' },
            fill: { value: theme.textMuted },
            align: { value: col.align },
            baseline: { value: 'middle' },
          },
        },
      });
    });

    // Table Task Row Cells
    columnsWithPos.forEach((col) => {
      if (col.key === 'name') {
        tableMarks.push({
          type: 'text',
          from: { data: 'tasks' },
          encode: {
            enter: {
              x: { field: 'labelX', offset: col.left },
              y: { field: 'yCenter' },
              baseline: { value: 'middle' },
              limit: { value: col.width - 12 },
              ellipsis: { value: '...' },
            },
            update: {
              text: { signal: "datum.wbs + ' ' + datum.name" },
              fontWeight: { signal: "datum.isParent ? 'bold' : 'normal'" },
              fontSize: { signal: "datum.isParent ? 12 : 11" },
              fill: { value: theme.textColor },
            },
          },
        });
      } else if (col.key === 'start') {
        tableMarks.push({
          type: 'text',
          from: { data: 'tasks' },
          encode: {
            enter: {
              x: { value: col.left + col.width / 2 },
              y: { field: 'yCenter' },
              baseline: { value: 'middle' },
              align: { value: 'center' },
              fontSize: { value: 11 },
              fontFamily: { value: 'monospace' },
              fill: { value: theme.textColor },
            },
            update: {
              text: { field: 'start' },
            },
          },
        });
      } else if (col.key === 'end') {
        tableMarks.push({
          type: 'text',
          from: { data: 'tasks' },
          encode: {
            enter: {
              x: { value: col.left + col.width / 2 },
              y: { field: 'yCenter' },
              baseline: { value: 'middle' },
              align: { value: 'center' },
              fontSize: { value: 11 },
              fontFamily: { value: 'monospace' },
              fill: { value: theme.textColor },
            },
            update: {
              text: { field: 'end' },
            },
          },
        });
      } else if (col.key === 'duration') {
        tableMarks.push({
          type: 'text',
          from: { data: 'tasks' },
          encode: {
            enter: {
              x: { value: col.right - 8 },
              y: { field: 'yCenter' },
              baseline: { value: 'middle' },
              align: { value: 'right' },
              fontSize: { value: 11 },
              fontFamily: { value: 'monospace' },
              fill: { value: theme.textColor },
            },
            update: {
              text: { signal: "datum.milestone ? '-' : datum.durationDays + 'd'" },
            },
          },
        });
      } else if (col.key === 'progress') {
        tableMarks.push({
          type: 'text',
          from: { data: 'tasks' },
          encode: {
            enter: {
              x: { value: col.right - 8 },
              y: { field: 'yCenter' },
              baseline: { value: 'middle' },
              align: { value: 'right' },
              fontSize: { value: 11 },
              fill: { value: theme.textColor },
            },
            update: {
              text: { signal: "round(datum.progress * 100) + '%'" },
            },
          },
        });
      } else if (col.key === 'assignee') {
        tableMarks.push({
          type: 'text',
          from: { data: 'tasks' },
          encode: {
            enter: {
              x: { value: col.left + 8 },
              y: { field: 'yCenter' },
              baseline: { value: 'middle' },
              align: { value: 'left' },
              fontSize: { value: 11 },
              fill: { value: theme.textColor },
              limit: { value: col.width - 12 },
              ellipsis: { value: '...' },
            },
            update: {
              text: { signal: "datum.displayAssignee ? datum.displayAssignee : '-'" },
            },
          },
        });
      }
    });
  }

  // Resource allocation marks (if enabled)
  const resourceMarks: any[] = [];
  if (showResourceAllocation) {
    if (mode === 'all' || mode === 'table') {
      // Section divider rule (table side)
      resourceMarks.push({
        type: 'rule',
        encode: {
          enter: {
            x: { value: mode === 'table' ? 0 : -(totalTableWidth + 10) },
            x2: { value: mode === 'table' ? totalTableWidth : { signal: 'width' } },
            y: { value: taskChartHeight + 14 },
            stroke: { value: theme.borderColor },
            strokeWidth: { value: 1.5 },
          },
        },
      });

      // Section header title
      resourceMarks.push({
        type: 'text',
        encode: {
          enter: {
            x: { value: mode === 'table' ? 8 : -totalTableWidth + 2 },
            y: { value: taskChartHeight + 28 },
            text: { value: 'RESOURCE ALLOCATION' },
            fontSize: { value: 10 },
            fontWeight: { value: 'bold' },
            fill: { value: theme.textMuted },
            baseline: { value: 'middle' },
          },
        },
      });

      // Resource row hover bands (table side)
      resourceMarks.push({
        name: 'resourceRow',
        type: 'rect',
        from: { data: 'resourceRows' },
        encode: {
          enter: {
            x: { value: mode === 'table' ? 0 : -(totalTableWidth + 10) },
            x2: { value: mode === 'table' ? totalTableWidth : { signal: 'width' } },
            y: { field: 'yTop' },
            height: { field: 'height' },
          },
          update: {
            fill: [
              {
                test: 'datum.rowIndex === rowHover',
                value: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
              },
              { value: 'transparent' },
            ],
          },
        },
      });

      // Resource row bottom separator lines (table side)
      resourceMarks.push({
        type: 'rule',
        from: { data: 'resourceRows' },
        encode: {
          enter: {
            x: { value: mode === 'table' ? 0 : -(totalTableWidth + 10) },
            x2: { value: mode === 'table' ? totalTableWidth : { signal: 'width' } },
            y: { field: 'yTop', offset: resourceRowHeight },
            stroke: { value: theme.gridColor },
            strokeWidth: { value: 1 },
            opacity: { value: 0.5 },
          },
        },
      });

      // Resource row labels in the table area
      resourceMarks.push({
        type: 'text',
        from: { data: 'resourceRows' },
        encode: {
          enter: {
            x: { value: mode === 'table' ? 8 : -totalTableWidth + 8 },
            y: { field: 'yCenter' },
            baseline: { value: 'middle' },
            fontSize: { value: 11 },
            fontWeight: { value: 'bold' },
            fill: { value: theme.textColor },
          },
          update: {
            text: { signal: "datum.displayResource + '  (' + datum.taskCountText + ')'" },
          },
        },
      });
    }

    if (mode === 'timeline') {
      // Section divider rule (timeline side)
      resourceMarks.push({
        type: 'rule',
        encode: {
          enter: {
            x: { value: 0 },
            x2: { signal: 'width' },
            y: { value: taskChartHeight + 14 },
            stroke: { value: theme.borderColor },
            strokeWidth: { value: 1.5 },
          },
        },
      });

      // Resource row hover bands (timeline side)
      resourceMarks.push({
        name: 'resourceRow',
        type: 'rect',
        from: { data: 'resourceRows' },
        encode: {
          enter: {
            x: { value: 0 },
            x2: { signal: 'width' },
            y: { field: 'yTop' },
            height: { field: 'height' },
          },
          update: {
            fill: [
              {
                test: 'datum.rowIndex === rowHover',
                value: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
              },
              { value: 'transparent' },
            ],
          },
        },
      });

      // Resource row bottom separator lines (timeline side)
      resourceMarks.push({
        type: 'rule',
        from: { data: 'resourceRows' },
        encode: {
          enter: {
            x: { value: 0 },
            x2: { signal: 'width' },
            y: { field: 'yTop', offset: resourceRowHeight },
            stroke: { value: theme.gridColor },
            strokeWidth: { value: 1 },
            opacity: { value: 0.5 },
          },
        },
      });
    }

    if (mode === 'all' || mode === 'timeline') {
      // Resource allocation interval workload blocks
      resourceMarks.push({
        type: 'rect',
        from: { data: 'resourceTasks' },
        encode: {
          enter: {
            cornerRadius: { value: 4 },
          },
          update: {
            x: { scale: 'timeScale', field: 'startTime' },
            x2: { scale: 'timeScale', field: 'endTime' },
            y: { field: 'yTop' },
            height: { field: 'barHeight' },
            fill: { field: 'fillColor' },
            opacity: { value: 0.85 },
            stroke: { field: 'strokeColor' },
            strokeWidth: { value: 1 },
            tooltip: {
              signal:
                "{'Resource': datum.displayResource, 'Workload': datum.workloadText, 'Tasks': datum.taskNames, 'Dates': datum.start + ' → ' + datum.end, 'Duration': datum.durationDays + 'd'}",
            },
          },
        },
      });

      // Resource allocation workload text
      resourceMarks.push({
        type: 'text',
        from: { data: 'resourceTasks' },
        encode: {
          enter: {
            align: { value: 'center' },
            baseline: { value: 'middle' },
            fontSize: { value: 11 },
            fontWeight: { value: 'bold' },
            fill: { value: '#ffffff' },
          },
          update: {
            x: {
              signal:
                "(scale('timeScale', datum.startTime) + scale('timeScale', datum.endTime)) / 2",
            },
            y: { field: 'yCenter' },
            text: { field: 'allocationText' },
            limit: {
              signal:
                "max(6, scale('timeScale', datum.endTime) - scale('timeScale', datum.startTime) - 4)",
            },
          },
        },
      });
    }
  }

  // Timeline Marks
  const timelineMarks: any[] = [
    // Milestone Diamonds
    {
      type: 'symbol',
      from: { data: 'tasks' },
      encode: {
        enter: {
          shape: { value: 'diamond' },
          size: { value: 150 },
          fill: { value: theme.milestoneColor },
          stroke: { value: '#ffffff' },
          strokeWidth: { value: 1 },
        },
        update: {
          x: { scale: 'timeScale', field: 'startTime' },
          y: { field: 'yCenter' },
          opacity: { signal: 'datum.milestone ? 1 : 0' },
          tooltip: {
            signal:
              "{'Milestone': datum.name, 'Date': datum.start, 'Assignee': datum.displayAssignee || 'Unassigned'}",
          },
        },
      },
    },

    // Standard & Parent Task Bars (Background outline / bar)
    {
      type: 'rect',
      from: { data: 'tasks' },
      encode: {
        enter: {
          cornerRadius: { value: 4 },
        },
        update: {
          x: { scale: 'timeScale', field: 'startTime' },
          x2: { scale: 'timeScale', field: 'endTime' },
          y: { field: 'yTop' },
          height: { field: 'barHeight' },
          fill: { scale: 'colorScale', field: colorField },
          opacity: { signal: 'datum.milestone ? 0 : (datum.isParent ? 0.35 : 0.45)' },
          stroke: { scale: 'colorScale', field: colorField },
          strokeWidth: { signal: 'datum.isParent ? 2 : 1' },
          strokeDash: { signal: 'datum.isParent ? [4, 2] : null' },
          tooltip: {
            signal:
              "{'Task': datum.name, 'Phase': datum.phaseName, 'Dates': datum.start + ' → ' + datum.end, 'Duration': datum.durationDays + 'd', 'Progress': round(datum.progress * 100) + '%', 'Assignee': datum.displayAssignee || 'Unassigned'}",
          },
        },
      },
    },

    // Progress Fill Bars
    {
      type: 'rect',
      from: { data: 'tasks' },
      encode: {
        enter: {
          cornerRadius: { value: 4 },
        },
        update: {
          x: { scale: 'timeScale', field: 'startTime' },
          x2: { scale: 'timeScale', field: 'progressTime' },
          y: { field: 'yTop' },
          height: { field: 'barHeight' },
          fill: { scale: 'colorScale', field: colorField },
          opacity: { signal: 'datum.milestone || datum.progress === 0 ? 0 : 0.95' },
        },
      },
    },

    // Assignee Badges / Tags next to task bars
    {
      type: 'text',
      from: { data: 'tasks' },
      encode: {
        enter: {
          baseline: { value: 'middle' },
          fontSize: { value: 10 },
          fontStyle: { value: 'italic' },
          fill: { value: theme.textMuted },
        },
        update: {
          x: { scale: 'timeScale', field: 'endTime', offset: 8 },
          y: { field: 'yCenter' },
          text: { field: 'displayAssigneeText' },
          opacity: { signal: 'datum.displayAssignee ? 1 : 0' },
        },
      },
    },

    // Dependency Link Connectors (Orthogonal lines with arrows)
    {
      type: 'path',
      from: { data: 'links' },
      encode: {
        enter: {
          stroke: { value: theme.dependencyColor },
          strokeWidth: { value: 1.5 },
          strokeOpacity: { value: 0.8 },
          fill: { value: 'transparent' },
        },
        update: {
          path: {
            signal:
              "'M ' + scale('timeScale', datum.sourceTime) + ' ' + datum.sourceY + " +
              "' L ' + (scale('timeScale', datum.sourceTime) + 10) + ' ' + datum.sourceY + " +
              "' L ' + (scale('timeScale', datum.sourceTime) + 10) + ' ' + datum.targetY + " +
              "' L ' + scale('timeScale', datum.targetTime) + ' ' + datum.targetY",
          },
        },
      },
    },

    // Dependency Link Arrowheads
    {
      type: 'symbol',
      from: { data: 'links' },
      encode: {
        enter: {
          shape: { value: 'triangle-right' },
          size: { value: 30 },
          fill: { value: theme.dependencyColor },
        },
        update: {
          x: { scale: 'timeScale', field: 'targetTime' },
          y: { field: 'targetY' },
        },
      },
    },

    // Today Marker Line (Dashed red line)
    {
      type: 'rule',
      from: { data: 'today' },
      encode: {
        enter: {
          stroke: { value: theme.todayLineColor },
          strokeWidth: { value: 1.5 },
          strokeDash: { value: [4, 3] },
          y: { value: 0 },
          y2: { value: totalChartHeight },
        },
        update: {
          x: { scale: 'timeScale', field: 'todayTime' },
        },
      },
    },

    // Today Marker Tag
    {
      type: 'text',
      from: { data: 'today' },
      encode: {
        enter: {
          text: { value: 'Today' },
          fontSize: { value: 9 },
          fontWeight: { value: 'bold' },
          fill: { value: theme.todayLineColor },
          baseline: { value: 'bottom' },
          align: { value: 'center' },
        },
        update: {
          x: { scale: 'timeScale', field: 'todayTime' },
          y: { value: -2 },
        },
      },
    },
  ];

  const finalMarks: any[] = [];

  if (mode === 'table') {
    finalMarks.push(
      // Task Row hover bands (table side)
      {
        name: 'taskRow',
        type: 'rect',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: 0 },
            x2: { value: totalTableWidth },
            y: { field: 'index', mult: rowHeight },
            height: { value: rowHeight },
          },
          update: {
            fill: [
              {
                test: 'datum.index === rowHover',
                value: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
              },
              { value: 'transparent' },
            ],
          },
        },
      },
      // Task Row separator lines (table side)
      {
        type: 'rule',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: 0 },
            x2: { value: totalTableWidth },
            y: { field: 'index', mult: rowHeight, offset: rowHeight },
            stroke: { value: theme.gridColor },
            strokeWidth: { value: 1 },
            opacity: { value: 0.5 },
          },
        },
      },
      ...tableMarks,
      ...resourceMarks
    );
  } else if (mode === 'timeline') {
    finalMarks.push(
      // Weekend shading columns
      {
        type: 'rect',
        from: { data: 'weekends' },
        encode: {
          enter: {
            fill: { value: theme.weekendColor },
            y: { value: 0 },
            y2: { value: totalChartHeight },
          },
          update: {
            x: { scale: 'timeScale', field: 'startTime' },
            x2: { scale: 'timeScale', field: 'endTime' },
          },
        },
      },
      // Task Row hover bands (timeline side)
      {
        name: 'taskRow',
        type: 'rect',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: 0 },
            x2: { signal: 'width' },
            y: { field: 'index', mult: rowHeight },
            height: { value: rowHeight },
          },
          update: {
            fill: [
              {
                test: 'datum.index === rowHover',
                value: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
              },
              { value: 'transparent' },
            ],
          },
        },
      },
      // Task Row separator lines (timeline side)
      {
        type: 'rule',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: 0 },
            x2: { signal: 'width' },
            y: { field: 'index', mult: rowHeight, offset: rowHeight },
            stroke: { value: theme.gridColor },
            strokeWidth: { value: 1 },
            opacity: { value: 0.5 },
          },
        },
      },
      ...timelineMarks,
      ...resourceMarks
    );
  } else {
    // mode === 'all'
    finalMarks.push(
      // Weekend shading columns
      {
        type: 'rect',
        from: { data: 'weekends' },
        encode: {
          enter: {
            fill: { value: theme.weekendColor },
            y: { value: 0 },
            y2: { value: totalChartHeight },
          },
          update: {
            x: { scale: 'timeScale', field: 'startTime' },
            x2: { scale: 'timeScale', field: 'endTime' },
          },
        },
      },
      // Vertical table divider rule at X = 0
      {
        type: 'rule',
        encode: {
          enter: {
            x: { value: 0 },
            y: { value: 0 },
            y2: { value: totalChartHeight },
            stroke: { value: theme.borderColor },
            strokeWidth: { value: 1 },
          },
        },
      },
      // Task Row hover bands spanning full chart
      {
        name: 'taskRow',
        type: 'rect',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: -(totalTableWidth + 10) },
            x2: { signal: 'width' },
            y: { field: 'index', mult: rowHeight },
            height: { value: rowHeight },
          },
          update: {
            fill: [
              {
                test: 'datum.index === rowHover',
                value: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
              },
              { value: 'transparent' },
            ],
          },
        },
      },
      // Task Row separator lines spanning full chart
      {
        type: 'rule',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: -(totalTableWidth + 10) },
            x2: { signal: 'width' },
            y: { field: 'index', mult: rowHeight, offset: rowHeight },
            stroke: { value: theme.gridColor },
            strokeWidth: { value: 1 },
            opacity: { value: 0.5 },
          },
        },
      },
      ...tableMarks,
      ...timelineMarks,
      ...resourceMarks
    );
  }

  const specData: any[] = [];
  if (mode === 'table') {
    specData.push({
      name: 'tasks',
      values: colorData,
    });
    if (showResourceAllocation) {
      specData.push({
        name: 'resourceRows',
        values: resourceRowsData,
      });
    }
  } else {
    specData.push(
      {
        name: 'weekends',
        values: weekendsData,
        transform: [
          {
            type: 'formula',
            as: 'startTime',
            expr: 'time(datetime(datum.start))',
          },
          {
            type: 'formula',
            as: 'endTime',
            expr: 'time(datetime(datum.end))',
          },
        ],
      },
      {
        name: 'tasks',
        values: colorData,
        transform: [
          {
            type: 'formula',
            as: 'startTime',
            expr: 'time(datetime(datum.start))',
          },
          {
            type: 'formula',
            as: 'endTime',
            expr: 'time(datetime(datum.end))',
          },
          {
            type: 'formula',
            as: 'progressTime',
            expr: 'datum.startTime + (datum.endTime - datum.startTime) * datum.progress',
          },
        ],
      },
      {
        name: 'links',
        values: linksData,
        transform: [
          {
            type: 'formula',
            as: 'sourceTime',
            expr: 'time(datetime(datum.sourceEnd))',
          },
          {
            type: 'formula',
            as: 'targetTime',
            expr: 'time(datetime(datum.targetStart))',
          },
        ],
      },
      {
        name: 'today',
        values: todayValues,
        transform: [
          {
            type: 'formula',
            as: 'todayTime',
            expr: 'time(datetime(datum.date))',
          },
        ],
      },
      ...(showResourceAllocation
        ? [
            {
              name: 'resourceRows',
              values: resourceRowsData,
            },
            {
              name: 'resourceTasks',
              values: resourceTasksData,
              transform: [
                {
                  type: 'formula',
                  as: 'startTime',
                  expr: 'time(datetime(datum.start))',
                },
                {
                  type: 'formula',
                  as: 'endTime',
                  expr: 'time(datetime(datum.end))',
                },
              ],
            },
          ]
        : [])
    );
  }

  const specScales: any[] = [];
  const specAxes: any[] = [];

  if (mode !== 'table') {
    specScales.push(
      {
        name: 'timeScale',
        type: 'time',
        domain: {
          fields: [
            { data: 'tasks', field: 'startTime' },
            { data: 'tasks', field: 'endTime' },
            ...(showResourceAllocation
              ? [
                  { data: 'resourceTasks', field: 'startTime' },
                  { data: 'resourceTasks', field: 'endTime' },
                ]
              : []),
          ],
        },
        range: 'width',
      },
      {
        name: 'colorScale',
        type: 'ordinal',
        domain: {
          fields: [
            { data: 'tasks', field: colorField },
            ...(showResourceAllocation ? [{ data: 'resourceTasks', field: 'colorKey' }] : []),
          ],
        },
        range: { scheme: 'category10' },
      }
    );

    specAxes.push({
      orient: 'top',
      scale: 'timeScale',
      grid: true,
      gridColor: theme.gridColor,
      gridDash: [2, 2],
      gridOpacity: 0.8,
      labelColor: theme.textMuted,
      tickColor: theme.borderColor,
      domainColor: theme.borderColor,
      labelFontSize: 11,
      title: mode === 'timeline' ? undefined : model.title,
      titleColor: theme.textColor,
      titleFontSize: 13,
      titleFontWeight: 'bold',
      titlePadding: 16,
      ...(axisTicks.values && axisTicks.values.length > 0 ? { values: axisTicks.values } : {}),
      ...(axisTicks.format ? { format: axisTicks.format } : {}),
    });
  }

  return {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    description: model.title || 'Hierarchical Gantt Chart',
    width: mode === 'table' ? totalTableWidth : effectiveTimelineWidth,
    height: totalChartHeight,
    padding:
      mode === 'table'
        ? { top: headerHeight, left: 10, right: 0, bottom: 20 }
        : mode === 'timeline'
        ? { top: headerHeight, left: 0, right: 24, bottom: 20 }
        : { top: headerHeight, left: totalTableWidth + 10, right: 24, bottom: 20 },
    autosize: 'none',
    background: 'transparent',

    signals: [
      {
        name: 'rowHover',
        value: null,
        on: [
          { events: '@taskRow:mouseover', update: 'datum.index' },
          { events: '@taskRow:mouseout', update: 'null' },
          ...(showResourceAllocation
            ? [
                { events: '@resourceRow:mouseover', update: 'datum.rowIndex' },
                { events: '@resourceRow:mouseout', update: 'null' },
              ]
            : []),
        ],
      },
    ],

    data: specData,
    scales: specScales,
    axes: specAxes,
    marks: finalMarks,
  };
}

/**
 * Copies the Gantt chart rendered in a Vega View to clipboard as a PNG image.
 */
export async function copyGanttAsPng(
  viewResult: any,
  fallbackTitle: string = 'gantt-chart'
): Promise<boolean> {
  const view = viewResult?.view || viewResult;
  if (!view || typeof view.toCanvas !== 'function') {
    throw new Error('Vega view instance not ready');
  }

  // 2x scaleFactor for crisp retina resolution
  const canvas: HTMLCanvasElement = await view.toCanvas(2);

  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve(false);
        return;
      }

      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof ClipboardItem !== 'undefined' &&
        typeof navigator.clipboard.write === 'function'
      ) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          resolve(true);
          return;
        } catch (e) {
          console.warn('ClipboardItem write failed, using fallback:', e);
        }
      }

      // Fallback: trigger browser PNG download
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const sanitized = fallbackTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        a.download = `${sanitized || 'gantt-chart'}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve(true);
      } catch {
        resolve(false);
      }
    }, 'image/png');
  });
}

/**
 * Lazy loads vega-embed and renders the interactive Gantt chart inside a container element.
 * Splits into a frozen left table pane and a horizontally scrollable right timeline pane.
 */
export async function renderVegaGantt(
  container: HTMLElement,
  model: GanttParsedModel,
  isDark: boolean = false
): Promise<any> {
  const vegaEmbed = (await import('vega-embed')).default;

  // Measure available container width
  const containerWidth = container.clientWidth || container.parentElement?.clientWidth;

  // Calculate table width
  const maxLabelLen = Math.max(
    8,
    ...model.tasks.map((t) => (t.wbs ? `${t.wbs} ` : '').length + t.name.length + t.depth * 2)
  );
  const nameWidth = Math.min(260, Math.max(120, Math.round(maxLabelLen * 7.5 + 20)));
  const colConfigs: { width: number }[] = [];
  const rawColList = model.columns && model.columns.length > 0 ? model.columns : ['name'];
  for (const rawCol of rawColList) {
    const k = rawCol.toLowerCase().replace(/[-_]/g, '');
    if (k === 'name' || k === 'task') colConfigs.push({ width: nameWidth });
    else if (k === 'start' || k === 'startdate' || k === 'end' || k === 'enddate') colConfigs.push({ width: 85 });
    else if (k === 'duration' || k === 'dur') colConfigs.push({ width: 55 });
    else if (k === 'progress' || k === 'prog') colConfigs.push({ width: 65 });
    else if (k === 'assignee' || k === 'assignees' || k === 'resource' || k === 'resources') colConfigs.push({ width: 95 });
  }
  const totalTableWidth = colConfigs.reduce((acc, c) => acc + c.width, 0);

  const effectiveTimelineWidth = calculateTimelineWidth(model, containerWidth, totalTableWidth);

  const tableSpec = buildVegaGanttSpec(model, {
    isDark,
    mode: 'table',
  });

  const timelineSpec = buildVegaGanttSpec(model, {
    isDark,
    mode: 'timeline',
    timelineWidth: effectiveTimelineWidth,
  });

  // Prepare split container DOM
  container.innerHTML = '';
  container.classList.remove('overflow-x-auto');
  container.classList.add('overflow-x-hidden', 'w-full');

  const splitWrapper = document.createElement('div');
  splitWrapper.className =
    'gantt-split-wrapper flex flex-row items-start w-full overflow-hidden bg-transparent select-none';

  const tablePane = document.createElement('div');
  tablePane.className =
    'gantt-table-pane flex-shrink-0 overflow-hidden bg-transparent';
  tablePane.style.width = `${totalTableWidth + 10}px`;

  const timelinePane = document.createElement('div');
  timelinePane.className =
    'gantt-timeline-pane flex-1 min-w-0 overflow-x-auto overflow-y-hidden bg-transparent';

  // Forward horizontal wheel events from table to timeline
  tablePane.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        timelinePane.scrollLeft += e.deltaX;
      }
    },
    { passive: true }
  );

  splitWrapper.appendChild(tablePane);
  splitWrapper.appendChild(timelinePane);
  container.appendChild(splitWrapper);

  const [tableRes, timelineRes] = await Promise.all([
    vegaEmbed(tablePane, tableSpec, {
      actions: false,
      renderer: 'svg',
      defaultStyle: false,
    }),
    vegaEmbed(timelinePane, timelineSpec, {
      actions: false,
      renderer: 'svg',
      defaultStyle: false,
    }),
  ]);

  const tableView = tableRes.view;
  const timelineView = timelineRes.view;

  // Synchronize row hover highlighting
  tableView.addSignalListener('rowHover', (_: string, val: any) => {
    timelineView.signal('rowHover', val).runAsync();
  });
  timelineView.addSignalListener('rowHover', (_: string, val: any) => {
    tableView.signal('rowHover', val).runAsync();
  });

  return {
    view: {
      toCanvas: async (scaleFactor: number = 2) => {
        const unifiedSpec = buildVegaGanttSpec(model, {
          isDark,
          mode: 'all',
          timelineWidth: effectiveTimelineWidth,
        });
        const vega = await import('vega');
        const runtime = vega.parse(unifiedSpec);
        const unifiedView = new vega.View(runtime, { renderer: 'canvas' });
        await unifiedView.runAsync();
        const canvas = await unifiedView.toCanvas(scaleFactor);
        unifiedView.finalize();
        return canvas;
      },
      toSVG: async () => {
        const unifiedSpec = buildVegaGanttSpec(model, {
          isDark,
          mode: 'all',
          timelineWidth: effectiveTimelineWidth,
        });
        const vega = await import('vega');
        const runtime = vega.parse(unifiedSpec);
        const unifiedView = new vega.View(runtime, { renderer: 'none' });
        await unifiedView.runAsync();
        const svg = await unifiedView.toSVG();
        unifiedView.finalize();
        return svg;
      },
      signal: (name: string, val?: any) => {
        if (val !== undefined) {
          tableView.signal(name, val);
          return timelineView.signal(name, val);
        }
        return timelineView.signal(name);
      },
      data: (name: string) => timelineView.data(name),
    },
    tableView,
    timelineView,
    finalize: () => {
      try {
        tableView.finalize();
      } catch (_) {}
      try {
        timelineView.finalize();
      } catch (_) {}
    },
  };
}
