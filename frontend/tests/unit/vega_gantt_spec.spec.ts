import { describe, it, expect } from 'vitest';
import * as vega from 'vega';
import { parseGanttMarkdown } from '../../src/utils/ganttParser';
import { buildVegaGanttSpec } from '../../src/components/editor/utils/vegaGanttTemplate';

describe('Vega Gantt Template Compiler', () => {
  it('compiles valid Vega specification from Gantt model', () => {
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

    // Compile spec using Vega runtime parser
    const runtime = vega.parse(spec);
    expect(runtime).toBeDefined();
    expect(typeof runtime).toBe('object');
  });

  it('compiles dark theme Vega specification properly', () => {
    const yaml = `
tasks:
  - id: t1
    name: Quick Task
    start: 2026-03-01
    duration: 2d
`;
    const model = parseGanttMarkdown(yaml);
    const darkSpec = buildVegaGanttSpec(model, true);
    expect(darkSpec.background).toBe('#18181b');

    const runtime = vega.parse(darkSpec);
    expect(runtime).toBeDefined();
  });
});
