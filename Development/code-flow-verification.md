# Code Flow Verification: Inactive Tab Content Sync

## External Change Detection Path

### 1. External Change Occurs
```
Runtime/Shell/AI Operation
↓
Modifies file content
```

### 2. EditorMemoryManager Detects Change
```typescript
// EditorMemoryManager.ts:382
private handleFileRepositoryChange(event: FileChangeEvent): void {
  if (event.type === 'create' || event.type === 'update') {
    const filePath = toAppPath((event.file as any).path || '');
    const newContent = (event.file as any).content || '';
    
    // External change processing
    this.updateFromExternal(filePath, newContent);
  }
}
```

### 3. Sync to TabStore
```typescript
// EditorMemoryManager.ts:418
private syncToTabStore(path: string, content: string, isDirty: boolean): void {
  const tabStore = useTabStore.getState();
  const tabs = tabStore.getAllTabs();
  
  // Find matching tabs
  const matchingTabs = tabs.filter(t => {
    const tabPath = toAppPath(t.path || '');
    return tabPath === path && (t.kind === 'editor' || t.kind === 'diff' || t.kind === 'ai');
  });
  
  // Update via tabStore
  tabStore.updateTabContent(firstTab.id, content, isDirty);
}
```

### 4. Update Tab State AND Cached Models
```typescript
// tabStore.ts:1025
updateTabContent: (tabId: string, content: string, isDirty = false) => {
  // ... find tabs and update tab state ...
  
  const newPanes = updatePanesRecursive(get().panes);
  if (hasChanges) {
    set({ panes: newPanes });
    
    // ✨ KEY FIX: Update cached Monaco models for inactive tabs
    for (const updatedTabId of updatedTabIds) {
      try {
        updateCachedModelContent(updatedTabId, content);
      } catch (e) {
        console.warn('[TabStore] Failed to update cached model for:', updatedTabId, e);
      }
    }
  }
}
```

### 5. Update Cached Model Directly
```typescript
// useMonacoModels.ts:43
export function updateCachedModelContent(tabId: string, content: string): void {
  const model = sharedModelMap.get(tabId);
  if (model && typeof model.isDisposed === 'function' && !model.isDisposed()) {
    try {
      const currentValue = model.getValue();
      if (currentValue !== content) {
        model.setValue(content);
        console.log('[useMonacoModels] Updated cached model content for inactive tab:', tabId);
      }
    } catch (e) {
      console.warn('[useMonacoModels] Failed to update cached model content:', e);
    }
  }
}
```

## Result

When user switches to the tab:
```typescript
// MonacoEditor.tsx:142
const model = getOrCreateModel(monacoRef.current, tabId, content, fileName);
// ✓ Model already has updated content from cache
```

## Verification Points

### ✅ Import/Export Chain
```
useMonacoModels.ts:43  → export function updateCachedModelContent
tabStore.ts:4          → import { updateCachedModelContent }
tabStore.ts:1086       → updateCachedModelContent(updatedTabId, content)
```

### ✅ Global Model Map
```typescript
// useMonacoModels.ts:31
const sharedModelMap: Map<string, monaco.editor.ITextModel> = new Map();

// Accessed by:
// 1. getOrCreateModel() - creates/retrieves models
// 2. updateCachedModelContent() - updates inactive tab models
```

### ✅ TabStore Integration
```typescript
// Tracks which tabs were updated
const updatedTabIds: string[] = [];

// Updates each tab's cached model
for (const updatedTabId of updatedTabIds) {
  updateCachedModelContent(updatedTabId, content);
}
```

## Test Scenarios Covered

### Scenario 1: Runtime Execution Changes File
```
1. Open file.js in tab
2. Switch to another tab (file.js becomes inactive)
3. Execute runtime code that modifies file.js
4. ✅ Cached model updated
5. Switch back to file.js
6. ✅ Content shows runtime changes
```

### Scenario 2: Shell Command Modifies File
```
1. Open test.txt in tab
2. Switch to another tab
3. Run shell command: echo "new content" > test.txt
4. ✅ Cached model updated
5. Switch back to test.txt
6. ✅ Content shows "new content"
```

### Scenario 3: AI Applies Code Changes
```
1. Open component.tsx in tab
2. Switch to another tab
3. AI generates and applies code changes
4. ✅ Cached model updated
5. Switch back to component.tsx
6. ✅ Content shows AI changes
```

### Scenario 4: Multiple Tabs Same File
```
1. Open file.js in pane 1
2. Open file.js in pane 2 (different paneId, same path)
3. Make pane 1 inactive, pane 2 inactive
4. External change to file.js
5. ✅ Both tabs' cached models updated
6. Switch to either pane
7. ✅ Both show updated content
```

## Error Handling

### Model Safety Check
```typescript
if (model && typeof model.isDisposed === 'function' && !model.isDisposed()) {
  // Only update if model is safe
}
```

### Content Change Check
```typescript
if (currentValue !== content) {
  // Only setValue if content actually changed
  model.setValue(content);
}
```

### Exception Handling
```typescript
try {
  updateCachedModelContent(updatedTabId, content);
} catch (e) {
  console.warn('[TabStore] Failed to update cached model for:', updatedTabId, e);
}
```

## Performance Characteristics

- **Time Complexity**: O(n) where n = number of tabs with matching path
- **Space Complexity**: O(1) - no additional memory allocation
- **Network**: No network calls
- **Disk I/O**: No disk operations
- **Blocking**: Non-blocking, synchronous updates

## Logging for Debugging

### Success Case
```
[useMonacoModels] Updated cached model content for inactive tab: /path/to/file.js
```

### Error Case
```
[TabStore] Failed to update cached model for: /path/to/file.js Error: ...
[useMonacoModels] Failed to update cached model content: Error: ...
```

## Conclusion

The fix successfully addresses the issue by:
1. ✅ Detecting when tabStore content updates
2. ✅ Accessing global Monaco model cache directly
3. ✅ Updating models independently of component rendering
4. ✅ Handling errors gracefully
5. ✅ Maintaining performance with minimal overhead
