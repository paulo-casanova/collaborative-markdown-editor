import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MermaidBlock } from '../../src/pages/ReaderPage';
import { useThemeStore } from '../../src/stores/themeStore';
import * as mermaidRenderer from '../../src/components/editor/utils/mermaidRenderer';

describe('Mermaid Dark Theme Rendering in Reader Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mermaidRenderer.clearMermaidCache();
    useThemeStore.setState({
      mode: 'light',
      resolvedTheme: 'light',
    });
  });

  it('renders MermaidBlock container with mermaid-svg-container class and mermaid-viewer testid', () => {
    const html = renderToStaticMarkup(<MermaidBlock source="flowchart TD\n  A --> B" />);
    expect(html).toContain('data-testid="mermaid-viewer"');
    expect(html).toContain('mermaid-svg-container');
    expect(html).toContain('bg-cme-bg-surface');
  });

  it('passes isDark=true to renderMermaidSvg when resolvedTheme is dark', async () => {
    useThemeStore.setState({
      mode: 'dark',
      resolvedTheme: 'dark',
    });

    const isDark = useThemeStore.getState().resolvedTheme === 'dark';
    expect(isDark).toBe(true);

    const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaidSvg').mockResolvedValue(
      '<svg id="dark-svg"><path class="flowchart-link" /></svg>'
    );

    const svg = await mermaidRenderer.renderMermaidSvg('flowchart TD\n  A --> B', isDark);
    expect(renderSpy).toHaveBeenCalledWith('flowchart TD\n  A --> B', true);
    expect(svg).toContain('dark-svg');
  });

  it('passes isDark=false to renderMermaidSvg when resolvedTheme is light or sepia', async () => {
    useThemeStore.setState({
      mode: 'light',
      resolvedTheme: 'light',
    });
    expect(useThemeStore.getState().resolvedTheme === 'dark').toBe(false);

    useThemeStore.setState({
      mode: 'sepia',
      resolvedTheme: 'sepia',
    });
    expect(useThemeStore.getState().resolvedTheme === 'dark').toBe(false);
  });
});
