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
 * Builds a complete, standalone Vega specification for the hierarchical Gantt chart.
 */
export function buildVegaGanttSpec(model: GanttParsedModel, isDark: boolean = false): any {
  const theme = getGanttTheme(isDark);

  const rowHeight = 36;
  const headerHeight = 45;

  // Compute compact, snug tableWidth based on actual label lengths
  const maxLabelLen = Math.max(
    8,
    ...model.tasks.map((t) => (t.wbs ? `${t.wbs} ` : '').length + t.name.length + t.depth * 2)
  );
  const tableWidth = Math.min(240, Math.max(110, Math.round(maxLabelLen * 7.5 + 20)));
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
      labelX: 10 + t.depth * 14,
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

  return {
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    description: model.title || 'Hierarchical Gantt Chart',
    width: minTimelineWidth,
    height: chartHeight,
    padding: { top: headerHeight, left: tableWidth + 10, right: 24, bottom: 20 },
    autosize: { type: 'pad', contains: 'padding' },
    background: 'transparent',

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
      // 0. Weekend Shading Columns
      {
        type: 'rect',
        from: { data: 'weekends' },
        encode: {
          enter: {
            fill: { value: theme.weekendColor },
            y: { value: 0 },
            y2: { value: chartHeight },
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
            y2: { value: chartHeight },
            stroke: { value: theme.borderColor },
            strokeWidth: { value: 1 },
          },
        },
      },

      // 2. Row hover bands
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
                value: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
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
            opacity: { value: 0.5 },
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
            limit: { value: tableWidth - 10 },
            ellipsis: { value: '...' },
          },
          update: {
            text: {
              signal: "datum.wbs + ' ' + datum.name",
            },
            fontWeight: { signal: "datum.isParent ? 'bold' : 'normal'" },
            fontSize: { signal: "datum.isParent ? 12 : 11" },
            fill: { value: theme.textColor },
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

      // 12. Today Marker Line (Dashed red line) - Only rendered if today is in date range
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

      // 13. Today Marker Tag
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
