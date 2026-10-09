import type * as monacoEditor from 'monaco-editor';

type DiffEditorModelOwner = Pick<monacoEditor.editor.IStandaloneDiffEditor, 'setModel'>;

interface DisposableDiffModel {
  isDisposed(): boolean;
  dispose(): void;
}

interface DiffEditorModels {
  original: DisposableDiffModel | null;
  modified: DisposableDiffModel | null;
}

export function detachAndDisposeDiffEditorModels(
  editor: DiffEditorModelOwner | null,
  models: DiffEditorModels
): void {
  editor?.setModel(null);

  for (const model of [models.original, models.modified]) {
    if (model && !model.isDisposed()) model.dispose();
  }
}
