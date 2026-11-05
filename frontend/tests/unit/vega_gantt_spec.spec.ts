import { describe, it, expect } from 'vitest';
import * as vega from 'vega';
import { parseGanttMarkdown } from '../../src/utils/ganttParser';
import { buildVegaGanttSpec, getWeekendsBetween, copyGanttAsPng } from '../../src/components/editor/utils/vegaGanttTemplate';

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

    // Compile spec using Vega runtime parser
    const runtime = vega.parse(spec);
    expect(runtime).toBeDefined();
    expect(typeof runtime).toBe('object');

    const view = new vega.View(runtime, { renderer: 'none' });
    await view.runAsync();
    expect(view.scale('timeScale')).toBeDefined();
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
});
