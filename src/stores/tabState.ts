export { tabActions } from './tabState/actions';
export {
  addChangeListener,
  addSaveListener,
  getContent,
  initTabSaveSync,
  isDirty,
  removeSaveTimerForPath,
  saveImmediately,
  setContent,
  updateFromExternal,
} from './tabState/contentSync';
export { tabState } from './tabState/state';
