import { describe, it, expect } from 'vitest';
import * as vega from 'vega';
import { parseGanttMarkdown } from '../../src/utils/ganttParser';
import {
  buildVegaGanttSpec,
  getWeekendsBetween,
  getAxisTicks,
  copyGanttAsPng,
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
    assignee: @alice
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
    expect(resourceTasks[1].resource).toBe('alice');

    const svg = await view.toSVG();
    expect(svg).toContain('RESOURCE ALLOCATION');
    expect(svg).toContain('@pasc');
    expect(svg).toContain('@alice');
    expect(svg).toContain('Start');
    expect(svg).toContain('End');
    expect(svg).toContain('Dur');
  });
});
