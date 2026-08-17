import elkLayouts from '@mermaid-js/layout-elk';
import mermaid, { type MermaidConfig } from 'mermaid';

mermaid.registerLayoutLoaders(elkLayouts);

let renderQueue = Promise.resolve();

export function renderDiagram(id: string, chart: string, config: MermaidConfig): Promise<string> {
  const render = async (): Promise<string> => {
    mermaid.initialize(config);
    const result = await mermaid.render(id, chart);
    if (!result?.svg) throw new Error('Mermaid returned no SVG.');
    return result.svg;
  };

  const result = renderQueue.then(render);
  renderQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
