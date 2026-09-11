import { beforeEach, describe, expect, it } from 'vitest';

import { fileRepository } from '@/engine/core/fileRepository';
import { importSingleFile } from '@/engine/in-ex/importSingleFile';
import { setupTestProject } from '../../_helpers/testProject';

describe('importSingleFile', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const project = await setupTestProject('ImportSingleFileTest');
    projectId = project.projectId;
    projectName = project.projectName;
  });

  it('stores an Office document as binary', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const file = createFile('slides.pptx', bytes);

    await importSingleFile(file, `/projects/${projectName}/slides.pptx`, projectName, projectId);

    const storedFile = await fileRepository.getFileByPath(projectId, '/slides.pptx');
    expect(storedFile?.isBufferArray).toBe(true);
    expect(Array.from(new Uint8Array(storedFile?.bufferContent || new ArrayBuffer(0)))).toEqual(
      Array.from(bytes)
    );
  });

  it('stores an SVG as text', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Pyxis</text></svg>';
    const file = createFile('logo.svg', new TextEncoder().encode(svg));

    await importSingleFile(file, `/projects/${projectName}/logo.svg`, projectName, projectId);

    const storedFile = await fileRepository.getFileByPath(projectId, '/logo.svg');
    expect(storedFile?.isBufferArray).toBe(false);
    expect(storedFile?.content).toBe(svg);
  });
});

function createFile(name: string, content: Uint8Array): File {
  const arrayBuffer = content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength
  ) as ArrayBuffer;

  return {
    name,
    arrayBuffer: async () => arrayBuffer,
  } as File;
}
