import { describe, it, expect } from 'vitest';
import * as vega from 'vega';
import { parseGanttMarkdown } from '../../src/utils/ganttParser';
import {
  buildVegaGanttSpec,
  getWeekendsBetween,
  getAxisTicks,
  copyGanttAsPng,
  computeResourceIntervals,
  calculateTimelineWidth,
  renderVegaGantt,
} from '../../src/components/editor/utils/vegaGanttTemplate';

describe('Vega Gantt Template Compiler', () => {
  it('compiles valid Vega specification from Gantt model', async () => {
    const yaml = `
title: Cloud Migration
colorBy: assignee
tasks:
  - id: t1
    name: Terraform Setup
    start: 2026-03-01
    duration: 5d
    assignee: @pasc
    progress: 80%

  - id: t2
    name: Database Migration
    dependsOn: t1
    duration: 3d
    assignee: @alice
    progress: 20%

  - id: t3
    name: Go-Live
    dependsOn: t2
    milestone: true
`;

    const model = parseGanttMarkdown(yaml);
    expect(model.errors).toHaveLength(0);

    const spec = buildVegaGanttSpec(model, false);
    expect(spec).toBeDefined();
    expect(spec.description).toBe('Cloud Migration');
    expect(spec.background).toBe('transparent');

    // Weekends data present
    const weekendsData = spec.data.find((d: any) => d.name === 'weekends');
    expect(weekendsData).toBeDefined();
    expect(Array.isArray(weekendsData.values)).toBe(true);

    // Today dataset is empty when project dates are in March 2026 and today is not in that range
    const todayData = spec.data.find((d: any) => d.name === 'today');
    expect(todayData).toBeDefined();

    expect(spec.autosize).toBe('none');

    // Compile spec using Vega runtime parser
    const runtime = vega.parse(spec);
    expect(runtime).toBeDefined();
    expect(typeof runtime).toBe('object');

    const view = new vega.View(runtime, { renderer: 'none' });
    await view.runAsync();
    expect(view.scale('timeScale')).toBeDefined();

    const svg = await view.toSVG();
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
    expect(viewBox).toBeDefined();
    const [minX, minY, vbWidth, vbHeight] = viewBox!.split(' ').map(Number);
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    // Width should be width(600) + padding.left(180) + padding.right(24) = 804 (not bloated by autosize: 'pad')
    expect(vbWidth).toBe(600 + spec.padding.left + spec.padding.right);
  });

  it('compiles dark theme Vega specification properly with transparent background', () => {
    const yaml = `
tasks:
  - id: t1
    name: Quick Task
    start: 2026-03-01
    duration: 2d
`;
    const model = parseGanttMarkdown(yaml);
    const darkSpec = buildVegaGanttSpec(model, true);
    expect(darkSpec.background).toBe('transparent');

    const runtime = vega.parse(darkSpec);
    expect(runtime).toBeDefined();
  });

  it('calculates weekends between dates correctly', () => {
    const weekends = getWeekendsBetween('2026-12-01', '2026-12-15');
    expect(weekends.length).toBeGreaterThanOrEqual(2);
    expect(weekends[0].start).toBe('2026-12-05');
    expect(weekends[0].end).toBe('2026-12-07');
  });

  it('exports copyGanttAsPng helper', () => {
    expect(typeof copyGanttAsPng).toBe('function');
  });

  it('generates axis ticks for all, mondays, and start-of-month', () => {
    const mondays = getAxisTicks('2026-12-01', '2026-12-20', 'mondays');
    expect(mondays.values).toBeDefined();
    expect(mondays.format).toBe('%b %d (%a)');
    expect(mondays.values!.length).toBe(2);

    const monthStarts = getAxisTicks('2026-11-15', '2027-02-15', 'start-of-month');
    expect(monthStarts.values).toBeDefined();
    expect(monthStarts.format).toBe('%b %Y');
    expect(monthStarts.values!.length).toBeGreaterThanOrEqual(3);

    const allDays = getAxisTicks('2026-12-01', '2026-12-05', 'all');
    expect(allDays.values).toBeDefined();
    expect(allDays.values!.length).toBe(5);
  });

  it('compiles spec with multi-column table and resource allocation timeline', async () => {
    const yaml = `
title: Multi Track Project
columns:
  - start
  - end
  - duration
  - progress
  - assignee
resource-allocation: yes
axis: mondays
tasks:
  - id: t1
    name: Backend API
    start: 2026-12-01
    duration: 5d
    assignee: @pasc
    progress: 70%
  - id: t2
    name: Web Frontend
    dependsOn: t1
    duration: 4d
    assignee: @alice (50%)
    progress: 30%
`;
    const model = parseGanttMarkdown(yaml);
    expect(model.errors).toHaveLength(0);
    expect(model.showResourceAllocation).toBe(true);

    const spec = buildVegaGanttSpec(model, false);
    expect(spec.data.some((d: any) => d.name === 'resourceRows')).toBe(true);
    expect(spec.data.some((d: any) => d.name === 'resourceTasks')).toBe(true);

    // Verify Vega parses and executes without error
    const runtime = vega.parse(spec);
    const view = new vega.View(runtime, { renderer: 'none' });
    await view.runAsync();

    const resourceTasks = view.data('resourceTasks');
    expect(resourceTasks).toHaveLength(2);
    expect(resourceTasks[0].resource).toBe('pasc');
    expect(resourceTasks[0].allocationText).toBe('1');
    expect(resourceTasks[1].resource).toBe('alice');
    expect(resourceTasks[1].allocationText).toBe('50%');

    const svg = await view.toSVG();
    expect(svg).toContain('RESOURCE ALLOCATION');
    expect(svg).toContain('@pasc');
    expect(svg).toContain('@alice');
    expect(svg).toContain('50%');
    expect(svg).toContain('Start');
    expect(svg).toContain('End');
    expect(svg).toContain('Dur');
  });

  it('splits overlapping tasks into workload interval chunks with active task counts', async () => {
    const yaml = `
resource-allocation: yes
tasks:
  - id: t1
    name: Backend API
    start: 2026-12-01
    end: 2026-12-10
    assignee: @pasc
  - id: t2
    name: Database Migration
    start: 2026-12-05
    end: 2026-12-15
    assignee: @pasc
`;
    const model = parseGanttMarkdown(yaml);
    expect(model.errors).toHaveLength(0);

    const spec = buildVegaGanttSpec(model, false);
    const runtime = vega.parse(spec);
    const view = new vega.View(runtime, { renderer: 'none' });
    await view.runAsync();

    const resourceTasks = view.data('resourceTasks');
    // Expect 3 chunks: Dec 1-5 (1), Dec 5-10 (2), Dec 10-15 (1)
    expect(resourceTasks).toHaveLength(3);

    expect(resourceTasks[0].start).toBe('2026-12-01');
    expect(resourceTasks[0].end).toBe('2026-12-05');
    expect(resourceTasks[0].taskCount).toBe(1);
    expect(resourceTasks[0].allocationText).toBe('1');

    expect(resourceTasks[1].start).toBe('2026-12-05');
    expect(resourceTasks[1].end).toBe('2026-12-10');
    expect(resourceTasks[1].taskCount).toBe(2);
    expect(resourceTasks[1].allocationText).toBe('2');

    expect(resourceTasks[2].start).toBe('2026-12-10');
    expect(resourceTasks[2].end).toBe('2026-12-15');
    expect(resourceTasks[2].taskCount).toBe(1);
    expect(resourceTasks[2].allocationText).toBe('1');

    const svg = await view.toSVG();
    expect(svg).toContain('1');
    expect(svg).toContain('2');
  });

  it('handles computeResourceIntervals with merging and complex overlap pyramids', () => {
    const tasks: any[] = [
      {
        id: 't1',
        name: 'Task 1',
        start: '2026-12-01',
        end: '2026-12-20',
        assignees: ['pasc'],
        isParent: false,
        milestone: false,
      },
      {
        id: 't2',
        name: 'Task 2',
        start: '2026-12-05',
        end: '2026-12-15',
        assignees: ['pasc'],
        isParent: false,
        milestone: false,
      },
      {
        id: 't3',
        name: 'Task 3',
        start: '2026-12-08',
        end: '2026-12-12',
        assignees: ['pasc'],
        isParent: false,
        milestone: false,
      },
    ];

    const intervals = computeResourceIntervals(tasks, 'pasc');
    // Boundaries: 12-01, 12-05, 12-08, 12-12, 12-15, 12-20
    // [01, 05]: 1
    // [05, 08]: 2
    // [08, 12]: 3
    // [12, 15]: 2
    // [15, 20]: 1
    expect(intervals).toHaveLength(5);
    expect(intervals.map((i) => i.taskCount)).toEqual([1, 2, 3, 2, 1]);
    expect(intervals.map((i) => i.allocationText)).toEqual(['1', '2', '3', '2', '1']);
  });

  it('merges contiguous non-overlapping tasks with identical task count', () => {
    const tasks: any[] = [
      {
        id: 't1',
        name: 'Task 1',
        start: '2026-12-01',
        end: '2026-12-05',
        assignees: ['pasc'],
        isParent: false,
        milestone: false,
      },
      {
        id: 't2',
        name: 'Task 2',
        start: '2026-12-05',
        end: '2026-12-10',
        assignees: ['pasc'],
        isParent: false,
        milestone: false,
      },
    ];

    const intervals = computeResourceIntervals(tasks, 'pasc');
    // [12-01, 12-05] and [12-05, 12-10] are contiguous and both have count 1 -> merge to [12-01, 12-10]
    expect(intervals).toHaveLength(1);
    expect(intervals[0].start).toBe('2026-12-01');
    expect(intervals[0].end).toBe('2026-12-10');
    expect(intervals[0].taskCount).toBe(1);
    expect(intervals[0].allocationText).toBe('1');
    expect(intervals[0].taskNames).toContain('Task 1');
    expect(intervals[0].taskNames).toContain('Task 2');
  });

  it('calculates timeline width dynamically or from user configuration', () => {
    const yamlFixed = `
width: 1500
tasks:
  - id: t1
    start: 2026-12-01
    duration: 10d
`;
    const modelFixed = parseGanttMarkdown(yamlFixed);
    expect(calculateTimelineWidth(modelFixed, 800, 300)).toBe(1500);

    const yamlAuto = `
width: auto
tasks:
  - id: t1
    start: 2026-12-01
    duration: 60d
`;
    const modelAuto = parseGanttMarkdown(yamlAuto);
    // 60 days * 25px/day = 1500px
    const autoWidth = calculateTimelineWidth(modelAuto, 800, 300);
    expect(autoWidth).toBeGreaterThanOrEqual(1200);

    const yamlDefault = `
tasks:
  - id: t1
    start: 2026-12-01
    duration: 10d
`;
    const modelDefault = parseGanttMarkdown(yamlDefault);
    // When container width is 900 and table is 300, fits the reading column
    expect(calculateTimelineWidth(modelDefault, 900, 300)).toBe(560);
    // When no container width is provided, defaults to 600
    expect(calculateTimelineWidth(modelDefault, undefined, 300)).toBe(600);
  });

  it('compiles standalone table spec and standalone timeline spec', async () => {
    const yaml = `
columns: [start, end, duration, progress]
resource-allocation: yes
tasks:
  - id: t1
    name: Architecture Audit
    start: 2026-12-01
    duration: 5d
    assignee: @pasc
    progress: 50%
`;
    const model = parseGanttMarkdown(yaml);

    // 1. Standalone Table Spec
    const tableSpec = buildVegaGanttSpec(model, { isDark: false, mode: 'table' });
    expect(tableSpec.scales).toHaveLength(0);
    expect(tableSpec.axes).toHaveLength(0);
    expect(tableSpec.data.some((d: any) => d.name === 'tasks')).toBe(true);
    expect(tableSpec.data.some((d: any) => d.name === 'resourceRows')).toBe(true);

    const tableRuntime = vega.parse(tableSpec);
    const tableView = new vega.View(tableRuntime, { renderer: 'none' });
    await tableView.runAsync();
    const tableSvg = await tableView.toSVG();
    expect(tableSvg).toContain('Architecture');
    expect(tableSvg).toContain('RESOURCE ALLOCATION');
    expect(tableSvg).toContain('@pasc');

    // 2. Standalone Timeline Spec
    const timelineSpec = buildVegaGanttSpec(model, {
      isDark: false,
      mode: 'timeline',
      timelineWidth: 1200,
    });
    expect(timelineSpec.width).toBe(1200);
    expect(timelineSpec.scales.some((s: any) => s.name === 'timeScale')).toBe(true);
    expect(timelineSpec.axes.some((a: any) => a.scale === 'timeScale')).toBe(true);

    const timelineRuntime = vega.parse(timelineSpec);
    const timelineView = new vega.View(timelineRuntime, { renderer: 'none' });
    await timelineView.runAsync();
    const timelineSvg = await timelineView.toSVG();
    expect(timelineSvg).toContain('1'); // allocation block count
  });

  it('renders split frozen table and scrollable timeline with renderVegaGantt', async () => {
    const yaml = `
width: 1400
tasks:
  - id: t1
    name: Backend Service
    start: 2026-12-01
    duration: 5d
    assignee: @pasc
`;
    const model = parseGanttMarkdown(yaml);

    // Mock minimal DOM container & elements for Node test environment
    const originalDoc = (globalThis as any).document;
    const createMockElement = (tag: string) => {
      const el: any = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        children: [] as any[],
        classList: {
          add: vi.fn((...cls: string[]) => {
            el.className = (el.className + ' ' + cls.join(' ')).trim();
          }),
          remove: vi.fn((...cls: string[]) => {
            const classes = el.className.split(/\s+/);
            el.className = classes.filter((c: string) => !cls.includes(c)).join(' ');
          }),
        },
        appendChild: vi.fn((child: any) => {
          el.children.push(child);
          return child;
        }),
        addEventListener: vi.fn(),
        querySelector: vi.fn((sel: string) => {
          const cls = sel.replace('.', '');
          const search = (node: any): any => {
            if (node.className && node.className.includes(cls)) return node;
            for (const child of node.children || []) {
              const found = search(child);
              if (found) return found;
            }
            return null;
          };
          return search(el);
        }),
      };
      return el;
    };

    const container = createMockElement('div');
    container.clientWidth = 1000;

    (globalThis as any).document = {
      createElement: vi.fn((tag: string) => createMockElement(tag)),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };

    // Mock vega-embed to avoid browser Canvas requirement in Node
    const mockTableView = {
      addSignalListener: vi.fn(),
      signal: vi.fn(() => ({ runAsync: vi.fn() })),
      finalize: vi.fn(),
    };
    const mockTimelineView = {
      addSignalListener: vi.fn(),
      signal: vi.fn(() => ({ runAsync: vi.fn() })),
      finalize: vi.fn(),
      data: vi.fn(),
    };
    vi.doMock('vega-embed', () => ({
      default: vi.fn(async (target: any) => {
        if (target.className?.includes('gantt-table-pane')) {
          return { view: mockTableView };
        }
        return { view: mockTimelineView };
      }),
    }));

    try {
      const res = await renderVegaGantt(container as any, model, false);
      expect(container.querySelector('.gantt-split-wrapper')).not.toBeNull();
      expect(container.querySelector('.gantt-table-pane')).not.toBeNull();
      expect(container.querySelector('.gantt-timeline-pane')).not.toBeNull();

      // Verify timeline pane has overflow-x-auto
      const timelinePane = container.querySelector('.gantt-timeline-pane');
      expect(timelinePane.className).toContain('overflow-x-auto');

      // Verify signal listeners were wired between table and timeline
      expect(mockTableView.addSignalListener).toHaveBeenCalledWith('rowHover', expect.any(Function));
      expect(mockTimelineView.addSignalListener).toHaveBeenCalledWith('rowHover', expect.any(Function));

      // Verify res.view exports unified toSVG
      const unifiedSvg = await res.view.toSVG();
      expect(unifiedSvg).toBeDefined();
      expect(unifiedSvg).toContain('Backend');

      res.finalize();
      expect(mockTableView.finalize).toHaveBeenCalled();
      expect(mockTimelineView.finalize).toHaveBeenCalled();
    } finally {
      (globalThis as any).document = originalDoc;
      vi.doUnmock('vega-embed');
    }
  });
});
