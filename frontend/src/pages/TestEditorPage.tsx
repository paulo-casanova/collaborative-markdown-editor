import React from 'react';
import { CollaborativeEditor } from '../components/editor/CollaborativeEditor';

export const TestEditorPage: React.FC = () => {
  const fixtureContent = `
    <h1>E2E Test Document</h1>
    <p>This fixture tests all custom ProseMirror NodeViews rendered in the editor.</p>
    
    <div class="katex-display-block" data-latex="f(x) = \\int_{-\\infty}^\\infty \\hat{f}(\\xi)\\,e^{2 \\pi i \\xi x}\\,d\\xi"></div>

    <div class="mermaid" data-source="flowchart TD
    A[Start Node] --> B[Finish Node]"></div>

    <p>Check out the documentation at <a class="wiki-link" data-target="guides/intro.md">Introduction Guide</a>.</p>

    <pre data-language="typescript"><code>const greeting: string = "Hello Collaborative Editor";</code></pre>
  `;

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <h1 className="text-xl font-bold font-mono">E2E Fixture Testing Harness</h1>
      <CollaborativeEditor initialContent={fixtureContent} />
    </div>
  );
};
