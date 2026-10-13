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
    <p>Jump to top: <a class="wiki-link" data-target="#e2e-test-document">E2E Test Document</a>.</p>

    <pre data-language="typescript"><code>const greeting: string = "Hello Collaborative Editor";</code></pre>

    <pre><code>Plain untyped code line 1
Plain untyped code line 2</code></pre>

    <p>Inline formula: $E = mc^2$ and Euler identity: $e^{i\\pi} + 1 = 0$.</p>

    <table>
      <thead>
        <tr><th>Language</th><th>Typing</th><th>Performance</th></tr>
      </thead>
      <tbody>
        <tr><td>Rust</td><td>Static</td><td>High</td></tr>
        <tr><td>Python</td><td>Dynamic</td><td>Medium</td></tr>
      </tbody>
    </table>
  `;

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <h1 className="text-xl font-bold font-mono">E2E Fixture Testing Harness</h1>
      <CollaborativeEditor initialContent={fixtureContent} />
    </div>
  );
};
