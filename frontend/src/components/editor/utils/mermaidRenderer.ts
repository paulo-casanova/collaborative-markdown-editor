import mermaid from 'mermaid';

export function initMermaid(isDark: boolean = false) {
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'Inter, sans-serif',
    flowchart: {
      htmlLabels: true,
      curve: 'basis',
    },
  });
}

let counter = 0;
const svgCache = new Map<string, string>();

export function getCachedMermaidSvg(source: string, isDark: boolean = false): string | undefined {
  return svgCache.get(`${isDark ? 'dark' : 'light'}:${source.trim()}`);
}

export function clearMermaidCache(): void {
  svgCache.clear();
}

export async function renderMermaidSvg(source: string, isDark: boolean = false): Promise<string> {
  const cacheKey = `${isDark ? 'dark' : 'light'}:${source.trim()}`;
  const cached = svgCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  initMermaid(isDark);
  const id = `mermaid-svg-${Date.now()}-${counter++}`;
  try {
    const { svg } = await mermaid.render(id, source.trim());
    if (svgCache.size > 200) {
      const oldestKey = svgCache.keys().next().value;
      if (oldestKey) svgCache.delete(oldestKey);
    }
    svgCache.set(cacheKey, svg);
    return svg;
  } catch (error: any) {
    // Mermaid creates an error element in the body, remove it
    const errorEl = document.getElementById(id);
    if (errorEl) {
      errorEl.remove();
    }
    const dErrorEl = document.getElementById(`d${id}`);
    if (dErrorEl) {
      dErrorEl.remove();
    }
    throw error;
  }
}
