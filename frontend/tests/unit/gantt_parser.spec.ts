import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  parseProgress,
  formatDate,
  addDays,
  parseGanttMarkdown,
} from '../../src/utils/ganttParser';

describe('Gantt Parser & Scheduling Engine', () => {
  describe('Duration & Progress Utilities', () => {
    it('parses duration strings accurately', () => {
      expect(parseDuration('5d')).toBe(5);
      expect(parseDuration('5 days')).toBe(5);
      expect(parseDuration('2w')).toBe(14);
      expect(parseDuration('1 week')).toBe(7);
      expect(parseDuration('0d')).toBe(0);
      expect(parseDuration(10)).toBe(10);
      expect(parseDuration(undefined)).toBe(1);
    });

    it('parses progress percentage and decimals', () => {
      expect(parseProgress('100%')).toBe(1);
      expect(parseProgress('75%')).toBe(0.75);
      expect(parseProgress(0.5)).toBe(0.5);
      expect(parseProgress(50)).toBe(0.5);
      expect(parseProgress('0%')).toBe(0);
    });

    it('adds days with and without weekend skipping', () => {
      // Friday 2026-03-06
      const friday = new Date(2026, 2, 6);
      // Calendar days: Friday + 3 days = Monday 2026-03-09
      const calRes = addDays(friday, 3, false);
      expect(formatDate(calRes)).toBe('2026-03-09');

      // Workdays: Friday + 1 workday = Monday 2026-03-09
      const workRes = addDays(friday, 1, true);
      expect(formatDate(workRes)).toBe('2026-03-09');
    });
  });

  describe('Hierarchical Gantt Scheduling', () => {
    it('schedules tasks using durations and computes end dates', () => {
      const yaml = `
title: Simple Test
tasks:
  - id: t1
    name: Task 1
    start: 2026-03-01
    duration: 10d
    progress: 50%
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);
      expect(model.title).toBe('Simple Test');
      expect(model.tasks).toHaveLength(1);
      const t1 = model.tasks[0];
      expect(t1.start).toBe('2026-03-01');
      expect(t1.end).toBe('2026-03-11');
      expect(t1.progress).toBe(0.5);
    });

    it('cascades dependencies automatically without explicit start dates', () => {
      const yaml = `
tasks:
  - id: step1
    name: Initial Step
    start: 2026-03-01
    duration: 5d

  - id: step2
    name: Dependent Step
    dependsOn: step1
    duration: 3d

  - id: step3
    name: Milestone
    dependsOn: step2
    milestone: true
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);
      expect(model.tasks).toHaveLength(3);

      const s1 = model.tasks.find((t) => t.id === 'step1')!;
      const s2 = model.tasks.find((t) => t.id === 'step2')!;
      const s3 = model.tasks.find((t) => t.id === 'step3')!;

      expect(s1.start).toBe('2026-03-01');
      expect(s1.end).toBe('2026-03-06');

      // step2 starts right when step1 ends
      expect(s2.start).toBe('2026-03-06');
      expect(s2.end).toBe('2026-03-09');

      // step3 milestone
      expect(s3.start).toBe('2026-03-09');
      expect(s3.end).toBe('2026-03-09');
      expect(s3.milestone).toBe(true);

      // Links
      expect(model.links).toEqual([
        { source: 'step1', target: 'step2' },
        { source: 'step2', target: 'step3' },
      ]);
    });

    it('handles multiple predecessors by picking the latest completion date', () => {
      const yaml = `
tasks:
  - id: backend
    name: Backend API
    start: 2026-04-01
    duration: 10d # Ends 2026-04-11

  - id: frontend
    name: UI Wireframes
    start: 2026-04-01
    duration: 14d # Ends 2026-04-15

  - id: integration
    name: Integration Testing
    dependsOn: [backend, frontend]
    duration: 4d
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);

      const integ = model.tasks.find((t) => t.id === 'integration')!;
      // Should wait for frontend to finish on 2026-04-15
      expect(integ.start).toBe('2026-04-15');
      expect(integ.end).toBe('2026-04-19');
      expect(model.links).toHaveLength(2);
    });

    it('rolls up parent summary start, end, and progress from child tasks', () => {
      const yaml = `
tasks:
  - id: phase1
    name: Phase 1
    children:
      - id: childA
        name: Subtask A
        start: 2026-05-01
        duration: 5d
        progress: 100%
      - id: childB
        name: Subtask B
        start: 2026-05-06
        duration: 5d
        progress: 0%
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);
      expect(model.tasks).toHaveLength(3);

      const parent = model.tasks.find((t) => t.id === 'phase1')!;
      expect(parent.isParent).toBe(true);
      expect(parent.start).toBe('2026-05-01');
      expect(parent.end).toBe('2026-05-11');
      // 5 days @ 100% + 5 days @ 0% => 50%
      expect(parent.progress).toBe(0.5);
    });

    it('extracts assignees and normalizes @mentions', () => {
      const yaml = `
tasks:
  - id: task1
    name: Cloud Infra
    start: 2026-06-01
    duration: 2d
    assignee: @pasc
  - id: task2
    name: Database Setup
    start: 2026-06-03
    duration: 3d
    assignee: [@alice, Bob]
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);

      const t1 = model.tasks[0];
      expect(t1.assignees).toEqual(['pasc']);
      expect(t1.displayAssignee).toBe('@pasc');

      const t2 = model.tasks[1];
      expect(t2.assignees).toEqual(['alice', 'Bob']);
      expect(t2.displayAssignee).toBe('@alice, Bob');

      expect(model.assignees).toContain('pasc');
      expect(model.assignees).toContain('alice');
      expect(model.assignees).toContain('Bob');
    });

    it('handles circular dependencies gracefully with error detection', () => {
      const yaml = `
tasks:
  - id: a
    name: Task A
    dependsOn: b
  - id: b
    name: Task B
    dependsOn: a
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors.some((e) => e.includes('Circular dependency'))).toBe(true);
    });

    it('resolves dependencies by task name or case-insensitive id', () => {
      const yaml = `
tasks:
  - id: database-design
    name: Database Design
    start: 2026-12-01
    duration: 5d
  - id: frontend-design
    name: Frontend Design
    dependsOn: Database Design
    duration: 3d
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);
      expect(model.links).toHaveLength(1);
      expect(model.links[0].source).toBe('database-design');
      expect(model.links[0].target).toBe('frontend-design');
      expect(model.tasks[1].start).toBe('2026-12-06');
    });

    it('baselines unanchored tasks to earliest project start rather than today', () => {
      const yaml = `
tasks:
  - id: phase-1
    name: Phase 1
    start: 2027-06-01
    duration: 4d
  - id: phase-2
    name: Phase 2
    duration: 5d
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);
      expect(model.minDate).toBe('2027-06-01');
      expect(model.tasks[1].start).toBe('2027-06-01');
    });

    it('parses columns, resource-allocation, and axis options', () => {
      const yaml = `
columns:
  - start
  - end
  - duration
  - progress
resource-allocation: yes
axis: mondays
tasks:
  - id: t1
    name: Alpha
    start: 2026-12-01
    duration: 5d
    assignee: @pasc
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors).toHaveLength(0);
      expect(model.columns).toEqual(['name', 'start', 'end', 'duration', 'progress']);
      expect(model.showResourceAllocation).toBe(true);
      expect(model.axisInterval).toBe('mondays');
    });

    it('defaults columns to name, resource-allocation to false, and axis to auto', () => {
      const yaml = `
tasks:
  - id: t1
    name: Beta
    start: 2026-12-01
    duration: 3d
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.columns).toEqual(['name']);
      expect(model.showResourceAllocation).toBe(false);
      expect(model.axisInterval).toBe('auto');
    });

    it('returns friendly syntax error for invalid YAML syntax without throwing', () => {
      const yaml = `
tasks:
  - id: unclosed: [bad: {
`;
      const model = parseGanttMarkdown(yaml);
      expect(model.errors.some((e) => e.includes('YAML Syntax Error'))).toBe(true);
    });
  });
});
