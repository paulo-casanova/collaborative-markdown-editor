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

export async function renderMermaidSvg(source: string, isDark: boolean = false): Promise<string> {
  initMermaid(isDark);
  const id = `mermaid-svg-${Date.now()}-${counter++}`;
  try {
    const { svg } = await mermaid.render(id, source.trim());
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
