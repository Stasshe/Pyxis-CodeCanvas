# Fix: Inactive Tab Content Sync Issue

## Problem Statement

When a file was NOT currently displayed in the editor (tab exists but is inactive/not visible), external changes from runtime, shell, AI, etc. were not reflected in the editor content. When the user switched back to that tab, it displayed stale/outdated content.

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

## Solution

### Implementation

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

### Why This Works

1. **Direct Model Access**: The function accesses the global `sharedModelMap` directly
2. **No Component Required**: Works even when MonacoEditor component is not rendered
3. **Immediate Sync**: Updates happen as soon as tabStore.updateTabContent is called
4. **No Duplicates**: Only updates if content actually changed

## Changes Made

### 1. `src/components/Tab/text-editor/hooks/useMonacoModels.ts`
- Added `updateCachedModelContent()` module-level export
- Function updates cached models directly from the global map

### 2. `src/stores/tabStore.ts`
- Import `updateCachedModelContent`
- Track which tabs were updated in `updateTabContent()`
- Call `updateCachedModelContent()` for each updated tab

### 3. `src/components/Tab/text-editor/editors/MonacoEditor.tsx`
- Removed unused "force refresh" event listener (lines 172-201)
- This was no longer needed with the new solution

## Testing Verification

### Manual Test Procedure

1. **Setup**: Open a file (e.g., `test.js`) in the editor
2. **Open Another Tab**: Click on a different file to make `test.js` inactive (still in tab bar)
3. **External Change**: Use runtime/shell/AI to modify `test.js` content
4. **Verify**: Switch back to `test.js` tab
5. **Expected**: Content should show the updated version

### Before Fix
- Content remained stale/unchanged when switching back

### After Fix
- Content correctly shows external changes

## Technical Notes

### Why Not Use the Force Refresh Event?

The user mentioned the "force refresh" event (`pyxis-force-monaco-refresh`) was no longer used. Our solution is better because:

1. **No Event Bus Needed**: Direct function call is more reliable
2. **Synchronous**: Updates happen immediately, no event delay
3. **Cleaner Code**: Fewer moving parts, easier to maintain
4. **Type Safe**: Direct function call vs. string-based event

### Performance Considerations

- **Minimal Overhead**: Only updates models that actually changed
- **No Re-renders**: Doesn't trigger React re-renders
- **Efficient Lookup**: Uses Map for O(1) model lookup

## Related Code Paths

### Content Update Sources
1. **EditorMemoryManager**: External file changes
2. **Runtime Operations**: Code execution results
3. **Shell Operations**: File modifications
4. **AI Operations**: Code modifications

### All flow through
```
→ tabStore.updateTabContent()
→ updateCachedModelContent()
→ Monaco model synced
```

## Future Improvements

1. **Batch Updates**: If multiple tabs change simultaneously, could batch model updates
2. **Change Tracking**: Could track which models were updated for debugging
3. **Event Notifications**: Could notify listeners when model content changes

## Conclusion

This fix ensures that inactive editor tabs correctly reflect external content changes by updating the cached Monaco models directly, independent of component rendering. The solution is elegant, performant, and maintainable.
