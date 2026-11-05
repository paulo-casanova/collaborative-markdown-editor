import type { GanttParsedModel } from '../../../utils/ganttParser';

export interface VegaGanttTheme {
  isDark: boolean;
  background: string;
  textColor: string;
  textMuted: string;
  gridColor: string;
  rowAltColor: string;
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
      background: '#18181b', // zinc-900
      textColor: '#f4f4f5',
      textMuted: '#a1a1aa',
      gridColor: '#27272a',
      rowAltColor: '#202024',
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
    background: '#ffffff',
    textColor: '#18181b',
    textMuted: '#71717a',
    gridColor: '#e4e4e7',
    rowAltColor: '#f8fafc',
    borderColor: '#e2e8f0',
    primaryColor: '#2563eb',
    progressColor: '#1d4ed8',
    milestoneColor: '#d97706',
    dependencyColor: '#3b82f6',
    todayLineColor: '#ef4444',
  };
}

/**
 * Builds a complete, standalone Vega specification for the hierarchical Gantt chart.
 */
export function buildVegaGanttSpec(model: GanttParsedModel, isDark: boolean = false): any {
  const theme = getGanttTheme(isDark);

  const rowHeight = 36;
  const headerHeight = 45;
  const tableWidth = 260;
  const minTimelineWidth = 600;
  const rowCount = Math.max(1, model.tasks.length);
  const chartHeight = rowCount * rowHeight;

  // Compute tasks dataset with row coordinates
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
      labelX: 12 + t.depth * 16,
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

  // Assignee color palette
  const colorField = model.colorBy === 'assignee' ? 'assigneeKey' : 'phaseKey';
  const colorData = tasksData.map((t) => ({
    ...t,
    assigneeKey: t.assignees[0] || 'Unassigned',
    phaseKey: t.phaseName || 'General',
  }));

  const todayStr = new Date().toISOString().split('T')[0];

  return {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    description: model.title || 'Hierarchical Gantt Chart',
    width: minTimelineWidth,
    height: chartHeight,
    padding: { top: headerHeight, left: tableWidth + 10, right: 30, bottom: 20 },
    autosize: { type: 'pad', contains: 'padding' },
    background: theme.background,

    signals: [
      {
        name: 'rowHover',
        value: null,
        on: [
          { events: '@taskRow:mouseover', update: 'datum.index' },
          { events: '@taskRow:mouseout', update: 'null' },
        ],
      },
    ],

    data: [
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
        values: [{ date: todayStr }],
        transform: [
          {
            type: 'formula',
            as: 'todayTime',
            expr: 'time(datetime(datum.date))',
          },
        ],
      },
    ],

    scales: [
      {
        name: 'timeScale',
        type: 'time',
        domain: {
          fields: [
            { data: 'tasks', field: 'startTime' },
            { data: 'tasks', field: 'endTime' },
          ],
        },
        range: 'width',
        nice: 'week',
      },
      {
        name: 'colorScale',
        type: 'ordinal',
        domain: { data: 'tasks', field: colorField },
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
      },
    ],

    marks: [
      // 1. Table Background Panel (Left Side Tree Area)
      {
        type: 'rect',
        encode: {
          enter: {
            x: { value: -(tableWidth + 10) },
            width: { value: tableWidth },
            y: { value: 0 },
            height: { value: chartHeight },
            fill: { value: theme.isDark ? '#141417' : '#fafafa' },
            stroke: { value: theme.borderColor },
            strokeWidth: { value: 1 },
          },
        },
      },

      // 2. Row background bands & hover effect
      {
        name: 'taskRow',
        type: 'rect',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: -(tableWidth + 10) },
            x2: { signal: 'width' },
            y: { field: 'index', mult: rowHeight },
            height: { value: rowHeight },
          },
          update: {
            fill: [
              {
                test: 'datum.index === rowHover',
                value: theme.isDark ? '#27272a' : '#f1f5f9',
              },
              {
                test: 'datum.index % 2 === 1',
                value: theme.rowAltColor,
              },
              { value: 'transparent' },
            ],
          },
        },
      },

      // 3. Row separator lines
      {
        type: 'rule',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { value: -(tableWidth + 10) },
            x2: { signal: 'width' },
            y: { field: 'index', mult: rowHeight, offset: rowHeight },
            stroke: { value: theme.gridColor },
            strokeWidth: { value: 1 },
            opacity: { value: 0.6 },
          },
        },
      },

      // 4. Table Header (Task / WBS Name)
      {
        type: 'text',
        encode: {
          enter: {
            x: { value: -tableWidth },
            y: { value: -12 },
            text: { value: 'Task / Milestone' },
            fontSize: { value: 11 },
            fontWeight: { value: 'bold' },
            fill: { value: theme.textMuted },
          },
        },
      },

      // 5. Task Tree Text Labels (Left Column)
      {
        type: 'text',
        from: { data: 'tasks' },
        encode: {
          enter: {
            x: { field: 'labelX', offset: -(tableWidth + 6) },
            y: { field: 'yCenter' },
            baseline: { value: 'middle' },
            limit: { value: tableWidth - 30 },
            ellipsis: { value: '...' },
          },
          update: {
            text: {
              signal: "datum.isParent ? (datum.wbs + ' ' + datum.name) : (datum.wbs + ' ' + datum.name)",
            },
            fontWeight: { signal: "datum.isParent ? 'bold' : 'normal'" },
            fontSize: { signal: "datum.isParent ? 12 : 11" },
            fill: { signal: "datum.isParent ? '" + theme.textColor + "' : '" + theme.textColor + "'" },
          },
        },
      },

      // 6. Milestone Diamonds
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

      // 7. Standard & Parent Task Bars (Background outline / bar)
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

      // 8. Progress Fill Bars
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

      // 9. Assignee Badges / Tags next to task bars
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

      // 10. Dependency Link Connectors (Orthogonal lines with arrows)
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

      // 11. Dependency Link Arrowheads
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

      // 12. Today Marker Line (Dashed red line)
      {
        type: 'rule',
        from: { data: 'today' },
        encode: {
          enter: {
            stroke: { value: theme.todayLineColor },
            strokeWidth: { value: 1.5 },
            strokeDash: { value: [4, 3] },
            y: { value: 0 },
            y2: { value: chartHeight },
          },
          update: {
            x: { scale: 'timeScale', field: 'todayTime' },
          },
        },
      },
    ],
  };
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
