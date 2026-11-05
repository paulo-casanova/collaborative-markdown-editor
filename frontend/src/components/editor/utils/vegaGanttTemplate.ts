import type { GanttParsedModel } from '../../../utils/ganttParser';

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

/**
 * Builds a complete, standalone Vega specification for the hierarchical Gantt chart.
 */
export function buildVegaGanttSpec(model: GanttParsedModel, isDark: boolean = false): any {
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

  let currentX = -totalTableWidth;
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

  const minTimelineWidth = 600;
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
      const yTop = resourceSectionY + rIndex * resourceRowHeight + 5;
      const yCenter = resourceSectionY + rIndex * resourceRowHeight + resourceRowHeight / 2;
      const barHeight = resourceRowHeight - 10;

      resourceRowsData.push({
        resource,
        displayResource: resource.startsWith('@') ? resource : `@${resource}`,
        taskCount: assignedTasks.length,
        taskCountText: `${assignedTasks.length} task${assignedTasks.length === 1 ? '' : 's'}`,
        index: rIndex,
        rowIndex: rowCount + rIndex,
        yTop: resourceSectionY + rIndex * resourceRowHeight,
        yCenter,
        height: resourceRowHeight,
      });

      for (const t of assignedTasks) {
        const alloc = t.assigneeAllocations?.[resource] ?? 1.0;
        const allocationPct = Math.round(alloc * 100);
        const allocationText = `${allocationPct}%`;

        resourceTasksData.push({
          resource,
          displayResource: resource.startsWith('@') ? resource : `@${resource}`,
          taskId: t.id,
          taskName: t.name,
          start: t.start,
          end: t.end,
          progress: t.progress,
          durationDays: t.durationDays,
          allocation: alloc,
          allocationPct,
          allocationText,
          yTop,
          yCenter,
          barHeight,
          colorKey: model.colorBy === 'assignee' ? resource : t.phaseName || 'General',
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

  // Subtle vertical column dividers
  columnsWithPos.forEach((col) => {
    if (col.right < 0) {
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
          y: { value: -12 },
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
            text: { signal: "datum.durationDays + 'd'" },
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

  // Resource allocation marks (if enabled)
  const resourceMarks: any[] = [];
  if (showResourceAllocation) {
    // Section divider rule
    resourceMarks.push({
      type: 'rule',
      encode: {
        enter: {
          x: { value: -(totalTableWidth + 10) },
          x2: { signal: 'width' },
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
          x: { value: -totalTableWidth + 2 },
          y: { value: taskChartHeight + 28 },
          text: { value: 'RESOURCE ALLOCATION' },
          fontSize: { value: 10 },
          fontWeight: { value: 'bold' },
          fill: { value: theme.textMuted },
          baseline: { value: 'middle' },
        },
      },
    });

    // Resource row hover bands
    resourceMarks.push({
      name: 'resourceRow',
      type: 'rect',
      from: { data: 'resourceRows' },
      encode: {
        enter: {
          x: { value: -(totalTableWidth + 10) },
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

    // Resource row bottom separator lines
    resourceMarks.push({
      type: 'rule',
      from: { data: 'resourceRows' },
      encode: {
        enter: {
          x: { value: -(totalTableWidth + 10) },
          x2: { signal: 'width' },
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
          x: { value: -totalTableWidth + 8 },
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

    // Resource allocation task allocation blocks
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
          fill: { scale: 'colorScale', field: 'colorKey' },
          opacity: { value: 0.75 },
          stroke: { scale: 'colorScale', field: 'colorKey' },
          strokeWidth: { value: 1 },
          tooltip: {
            signal:
              "{'Resource': datum.displayResource, 'Task': datum.taskName, 'Allocation': datum.allocationText, 'Dates': datum.start + ' → ' + datum.end, 'Duration': datum.durationDays + 'd'}",
          },
        },
      },
    });

    // Resource allocation percentage text centered inside each block
    resourceMarks.push({
      type: 'text',
      from: { data: 'resourceTasks' },
      encode: {
        enter: {
          align: { value: 'center' },
          baseline: { value: 'middle' },
          fontSize: { value: 10 },
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

  return {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    description: model.title || 'Hierarchical Gantt Chart',
    width: minTimelineWidth,
    height: totalChartHeight,
    padding: { top: headerHeight, left: totalTableWidth + 10, right: 24, bottom: 20 },
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

    data: [
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
                {
                  type: 'formula',
                  as: 'progressTime',
                  expr: 'datum.startTime + (datum.endTime - datum.startTime) * datum.progress',
                },
              ],
            },
          ]
        : []),
    ],

    scales: [
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
      },
    ],

    axes: [
      {
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
        title: model.title,
        titleColor: theme.textColor,
        titleFontSize: 13,
        titleFontWeight: 'bold',
        titlePadding: 16,
        ...(axisTicks.values && axisTicks.values.length > 0 ? { values: axisTicks.values } : {}),
        ...(axisTicks.format ? { format: axisTicks.format } : {}),
      },
    ],

    marks: [
      // 0. Weekend Shading Columns
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

      // 1. Vertical table divider rule (separating task names from timeline)
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

      // 2. Task Row hover bands
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

      // 3. Task Row separator lines
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

      // 4. Injected Table Marks (Headers, dividers, cell texts)
      ...tableMarks,

      // 5. Milestone Diamonds
      {
        type: 'symbol',
        from: {
          data: 'tasks',
        },
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

      // 6. Standard & Parent Task Bars (Background outline / bar)
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
            opacity: { signal: "datum.milestone ? 0 : (datum.isParent ? 0.35 : 0.45)" },
            stroke: { scale: 'colorScale', field: colorField },
            strokeWidth: { signal: "datum.isParent ? 2 : 1" },
            strokeDash: { signal: "datum.isParent ? [4, 2] : null" },
            tooltip: {
              signal:
                "{'Task': datum.name, 'Phase': datum.phaseName, 'Dates': datum.start + ' → ' + datum.end, 'Duration': datum.durationDays + 'd', 'Progress': round(datum.progress * 100) + '%', 'Assignee': datum.displayAssignee || 'Unassigned'}",
            },
          },
        },
      },

      // 7. Progress Fill Bars
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

      // 8. Assignee Badges / Tags next to task bars
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

      // 9. Dependency Link Connectors (Orthogonal lines with arrows)
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

      // 10. Dependency Link Arrowheads
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

      // 11. Today Marker Line (Dashed red line) - Only rendered if today is in date range
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

      // 12. Today Marker Tag
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

      // 13. Resource Allocation Section (Marks)
      ...resourceMarks,
    ],
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
 */
export async function renderVegaGantt(
  container: HTMLElement,
  model: GanttParsedModel,
  isDark: boolean = false
): Promise<any> {
  const vegaEmbed = (await import('vega-embed')).default;
  const spec = buildVegaGanttSpec(model, isDark);
  return vegaEmbed(container, spec, {
    actions: { export: true, source: false, compiled: false, editor: false },
    renderer: 'svg',
    defaultStyle: true,
  });
}
