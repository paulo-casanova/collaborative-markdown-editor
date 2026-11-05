import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdownToHtml } from '../../src/utils/markdownToHtml';
import { normalizeContentToMarkdown } from '../../src/utils/htmlToMarkdown';
import { parseGanttMarkdown } from '../../src/utils/ganttParser';
import { buildVegaGanttSpec } from '../../src/components/editor/utils/vegaGanttTemplate';

describe('Hierarchical Gantt Integration & Serialization', () => {
  const sampleGanttMarkdown = `\`\`\`gantt
title: Q1 Infrastructure Plan
colorBy: assignee
tasks:
  - id: p1
    name: Cloud Migration
    children:
      - id: terraform
        name: Terraform Setup
        start: 2026-03-01
        duration: 2w
        assignee: @pasc
        progress: 100%
      - id: db-sync
        name: Database Replication
        dependsOn: terraform
        duration: 10d
        assignee: [@pasc, @alice]
        progress: 60%
\`\`\``;

  it('serializes gantt code fences to HTML and back to markdown losslessly', () => {
    const html = parseMarkdownToHtml(sampleGanttMarkdown);
    expect(html).toContain('class="gantt"');
    expect(html).toContain('data-source="title: Q1 Infrastructure Plan');

    const recoveredMd = normalizeContentToMarkdown(html);
    expect(recoveredMd).toContain('```gantt');
    expect(recoveredMd).toContain('title: Q1 Infrastructure Plan');
    expect(recoveredMd).toContain('assignee: @pasc');
    expect(recoveredMd).toContain('dependsOn: terraform');
  });

  it('parses complex multi-level hierarchy with dependencies and durations', () => {
    const model = parseGanttMarkdown(`
title: Product Roadmap
tasks:
  - id: epic1
    name: Core Architecture
    children:
      - id: task1
        name: Data Model
        start: 2026-05-01
        duration: 5d
        progress: 100%
      - id: task2
        name: API Endpoints
        dependsOn: task1
        duration: 10d
        progress: 40%
  - id: epic2
    name: User Experience
    children:
      - id: task3
        name: Web Dashboard
        dependsOn: task2
        duration: 7d
        progress: 10%
      - id: milestone1
        name: Public Beta
        dependsOn: task3
        milestone: true
`);

    expect(model.errors).toHaveLength(0);
    expect(model.tasks).toHaveLength(6); // 2 epics + 3 tasks + 1 milestone

    const epic1 = model.tasks.find((t) => t.id === 'epic1')!;
    const task1 = model.tasks.find((t) => t.id === 'task1')!;
    const task2 = model.tasks.find((t) => t.id === 'task2')!;
    const task3 = model.tasks.find((t) => t.id === 'task3')!;
    const milestone1 = model.tasks.find((t) => t.id === 'milestone1')!;

    expect(task1.start).toBe('2026-05-01');
    expect(task1.end).toBe('2026-05-06');

    expect(task2.start).toBe('2026-05-06');
    expect(task2.end).toBe('2026-05-16');

    expect(epic1.start).toBe('2026-05-01');
    expect(epic1.end).toBe('2026-05-16');

    expect(task3.start).toBe('2026-05-16');
    expect(task3.end).toBe('2026-05-23');

    expect(milestone1.start).toBe('2026-05-23');
    expect(milestone1.milestone).toBe(true);

    expect(model.links).toEqual([
      { source: 'task1', target: 'task2' },
      { source: 'task2', target: 'task3' },
      { source: 'task3', target: 'milestone1' },
    ]);
  });

  it('builds a complete Vega specification containing data marks and dependency links', () => {
    const rawYaml = `
tasks:
  - id: a
    name: Task A
    start: 2026-01-01
    duration: 3d
  - id: b
    name: Task B
    dependsOn: a
    duration: 2d
`;
    const model = parseGanttMarkdown(rawYaml);
    const spec = buildVegaGanttSpec(model, false);

    expect(spec.data).toBeDefined();
    const tasksTable = spec.data.find((d: any) => d.name === 'tasks');
    const linksTable = spec.data.find((d: any) => d.name === 'links');

    expect(tasksTable).toBeDefined();
    expect(linksTable).toBeDefined();
    expect(linksTable.values).toHaveLength(1);
    expect(linksTable.values[0].sourceId).toBe('a');
    expect(linksTable.values[0].targetId).toBe('b');
  });
});
