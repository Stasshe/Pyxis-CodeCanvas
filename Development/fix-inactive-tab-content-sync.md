# Fix: Editor Tab Content Sync Issues

## Problem Statement

Two related issues were identified:

### Issue 1: Inactive Tab Content Not Syncing
When a file was NOT currently displayed in the editor (tab exists but is inactive/not visible), external changes from runtime, shell, AI, etc. were not reflected in the editor content. When the user switched back to that tab, it displayed stale/outdated content.

### Issue 2: Closed Tab Reopening with Stale Content
When a tab was **closed completely** and then **reopened** from file tree or operation window, it showed stale content even after external changes had been made to the file.

## Root Cause Analysis

### Architecture Overview

1. **Tab Rendering**: Only the **active tab** has its component rendered
   ```tsx
   // PaneContainer.tsx
   const TabComponent = activeTab ? tabRegistry.get(activeTab.kind)?.component : null;
   ```

2. **Monaco Model Caching**: Monaco editor models are cached globally in a singleton `sharedModelMap`
   ```typescript
   // useMonacoModels.ts
   const sharedModelMap: Map<string, monaco.editor.ITextModel> = new Map();
   ```

3. **Content Update Flow**: When external changes occur:
   ```
   External Change (runtime/shell/AI)
   → EditorMemoryManager.updateFromExternal()
   → tabStore.updateTabContent()
   → TabRegistry.updateContent()
   → Updates tab state in store
   ```

### The Bug

The content update flow only updated the **tab state** but NOT the **cached Monaco model**. When a tab was inactive:

1. The MonacoEditor component was NOT rendered
2. Its useEffect (which syncs model content) didn't run
3. The cached model retained old content
4. When switching back to the tab, it reused the stale cached model

```typescript
// MonacoEditor.tsx - This useEffect only runs when component is mounted
useEffect(() => {
  if (!isEditorSafe() || !monacoRef.current) return;
  const model = getOrCreateModel(monacoRef.current, tabId, content, fileName);
  
  // Content sync - only happens if component is active
  if (isModelSafe(model) && model!.getValue() !== content) {
    model!.setValue(content);
  }
}, [tabId, content, ...]);
```

### Issue 2 Root Cause: Closed Tab Reopening

When a tab is closed and reopened:
1. The tab is treated as **new** (not reused from existing tabs)
2. `EditorTabType.createTab()` is called with the `file` object
3. The `file.content` comes from FileItem cache, which may be **stale**
4. Fresh content from fileRepository is not loaded

```typescript
// Before fix: EditorTabType.createTab uses stale file.content
createTab: (file, options): EditorTab => {
  return {
    id: tabId,
    content: file.content || '', // ← Stale content from FileItem cache!
    ...
  };
}
```

## Solution

### Implementation for Issue 1: Inactive Tabs

Added a mechanism to update cached Monaco models independently of component rendering:

1. **Module-level update function** in `useMonacoModels.ts`:
   ```typescript
   export function updateCachedModelContent(tabId: string, content: string): void {
     const model = sharedModelMap.get(tabId);
     if (model && !model.isDisposed()) {
       const currentValue = model.getValue();
       if (currentValue !== content) {
         model.setValue(content);
       }
     }
   }
   ```

2. **Call from tabStore** in `tabStore.ts`:
   ```typescript
   updateTabContent: (tabId, content, isDirty) => {
     // ... update tab state ...
     
     // Update inactive tab cached models
     for (const updatedTabId of updatedTabIds) {
       updateCachedModelContent(updatedTabId, content);
     }
   }
   ```

### Implementation for Issue 2: Closed Tab Reopening

Made `tabStore.openTab()` async to load fresh content before creating new tabs:

```typescript
// tabStore.ts - Load fresh content for new tabs
openTab: async (file, options = {}) => {
  // ... existing tab search logic ...
  
  // NEW: Load fresh content for new editor/binary tabs
  let fileToCreate = file;
  if ((kind === 'editor' || kind === 'binary') && file.path) {
    try {
      const projectId = getCurrentProjectId();
      if (projectId) {
        const freshFile = await fileRepository.getFileByPath(projectId, file.path);
        if (freshFile) {
          // Use fresh content, preserve original file properties
          fileToCreate = {
            ...file,
            content: freshFile.content,
            isBufferArray: freshFile.isBufferArray ?? file.isBufferArray,
            bufferContent: freshFile.bufferContent ?? file.bufferContent,
          };
        }
      }
    } catch (e) {
      console.warn('[TabStore] Failed to load fresh content:', e);
      // Fallback: use cached file.content
    }
  }
  
  const newTab = tabDef.createTab(fileToCreate, ...);
}
```

### Why Both Solutions Work

**Issue 1 (Inactive Tabs)**:
1. **Direct Model Access**: Function accesses global `sharedModelMap` directly
2. **No Component Required**: Works even when MonacoEditor is not rendered
3. **Immediate Sync**: Updates happen as soon as tabStore.updateTabContent is called

**Issue 2 (Closed Tabs)**:
1. **Fresh Content**: Loads from fileRepository before tab creation
2. **Centralized**: All callers (FileTree, OperationWindow, etc.) benefit automatically
3. **Backward Compatible**: Existing callers work without await (no breaking change)
4. **Graceful Fallback**: Uses cached content if loading fails

## Changes Made

### 1. `src/components/Tab/text-editor/hooks/useMonacoModels.ts`
- Added `updateCachedModelContent()` module-level export
- Function updates cached models directly from the global map

### 2. `src/stores/tabStore.ts`
- **For Issue 1**: Import `updateCachedModelContent`, call it in `updateTabContent()`
- **For Issue 2**: Made `openTab()` async, import `fileRepository` and `getCurrentProjectId()`
- Load fresh content from fileRepository before calling `createTab()`
- Added JSDoc documentation for async behavior
- Preserve file properties with nullish coalescing

### 3. `src/components/Tab/text-editor/editors/MonacoEditor.tsx`
- Removed unused "force refresh" event listener
- This was no longer needed with the new solution

## Testing Verification

### Test Procedure for Issue 1: Inactive Tabs

1. **Setup**: Open a file (e.g., `test.js`) in the editor
2. **Open Another Tab**: Click on a different file to make `test.js` inactive (still in tab bar)
3. **External Change**: Use runtime/shell/AI to modify `test.js` content
4. **Verify**: Switch back to `test.js` tab
5. **Expected**: Content should show the updated version

### Test Procedure for Issue 2: Closed Tab Reopening

1. **Setup**: Open a file (e.g., `file.js`) in the editor
2. **Close Tab**: Close the tab completely (not just switch)
3. **External Change**: Use runtime/shell/AI to modify `file.js` content
4. **Reopen**: Open `file.js` from file tree or operation window
5. **Expected**: Content shows the latest changes ✅

### Before Fix
**Issue 1**: Content remained stale when switching back to inactive tabs
**Issue 2**: Content remained stale when reopening closed tabs

### After Fix
**Both Issues**: Content correctly shows external changes in all scenarios ✅

## Technical Notes

### Why Not Use the Force Refresh Event?

The user mentioned the "force refresh" event (`pyxis-force-monaco-refresh`) was no longer used. Our solution is better because:

1. **No Event Bus Needed**: Direct function call is more reliable
2. **Synchronous**: Updates happen immediately, no event delay
3. **Cleaner Code**: Fewer moving parts, easier to maintain
4. **Type Safe**: Direct function call vs. string-based event

### Why TabStore-Level Solution for Issue 2?

Loading fresh content in `tabStore.openTab()` instead of individual callers:

1. **Centralized Logic**: One place to maintain instead of multiple locations
2. **Consistency**: All callers (FileTree, OperationWindow, etc.) automatically benefit
3. **Maintainability**: Changes to loading logic only need one update
4. **No Duplication**: Avoids repeating the same code in multiple places

### Performance Considerations

**Issue 1 (Inactive Tabs)**:
- **Minimal Overhead**: Only updates models that actually changed
- **No Re-renders**: Doesn't trigger React re-renders
- **Efficient Lookup**: Uses Map for O(1) model lookup

**Issue 2 (Closed Tabs)**:
- **Async Loading**: Doesn't block UI while loading content
- **Cached Fallback**: Uses cached content if loading fails
- **Selective Loading**: Only loads for editor/binary tabs with paths

## Related Code Paths

### Content Update Sources
1. **EditorMemoryManager**: External file changes
2. **Runtime Operations**: Code execution results
3. **Shell Operations**: File modifications
4. **AI Operations**: Code modifications

### Flow for Issue 1 (Inactive Tabs)
```
External Change
→ EditorMemoryManager.updateFromExternal()
→ tabStore.updateTabContent()
→ updateCachedModelContent()
→ Monaco model synced (even if tab inactive)
```

### Flow for Issue 2 (Closed Tabs)
```
User Opens File
→ tabStore.openTab()
→ fileRepository.getFileByPath() (fresh content)
→ createTab(freshContent)
→ New tab with latest content
```

## Future Improvements

1. **Batch Updates**: If multiple tabs change simultaneously, could batch model updates
2. **Change Tracking**: Could track which models were updated for debugging
3. **Event Notifications**: Could notify listeners when model content changes
4. **Content Validation**: Could validate content integrity before applying

## Conclusion

These fixes ensure that editor tabs correctly reflect external content changes in all scenarios:
1. **Inactive tabs** (tabs visible in tab bar but not displayed) sync via cached Monaco model updates
2. **Closed tabs** (completely closed and reopened) load fresh content from fileRepository

Both solutions are elegant, performant, and maintainable, with centralized logic in tabStore for consistency.
