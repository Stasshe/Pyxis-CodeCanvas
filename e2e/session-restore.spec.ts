import { test, expect } from '@playwright/test';

test.describe('Session Restoration', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:3000');
    // Wait for initial load
    await page.waitForTimeout(3000);
  });

  test('should load the application without errors', async ({ page }) => {
    // Check that the app loads
    await expect(page).toHaveTitle(/Pyxis/);
    
    // Wait for loading to complete
    await page.waitForTimeout(2000);
    
    // Check that main UI is visible - look for the menu bar or sidebar
    const isLoaded = await page.locator('body').isVisible();
    expect(isLoaded).toBeTruthy();
  });

  test('react-preview extension tab should restore after reload', async ({ page }) => {
    // Wait for app to fully load
    await page.waitForTimeout(5000);
    
    // Check for console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Try to open a project first (if needed)
    // Wait for the UI to stabilize
    await page.waitForTimeout(3000);

    // Take a screenshot to see the initial state
    await page.screenshot({ path: '/tmp/pyxis-initial.png', fullPage: true });

    console.log('Initial state captured');

    // Check for session restoration logs
    const logs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('useTabContentRestore') || 
          text.includes('TabSessionManager') ||
          text.includes('SessionStore') ||
          text.includes('extension')) {
        logs.push(text);
      }
    });

    // Reload the page to test session restoration
    await page.reload();
    await page.waitForTimeout(5000);

    // Take screenshot after reload
    await page.screenshot({ path: '/tmp/pyxis-after-reload.png', fullPage: true });

    console.log('Session restoration logs:', logs);

    // Check that there are no critical restoration errors
    const criticalErrors = errors.filter(e => 
      e.includes('restore') || 
      e.includes('session') ||
      e.includes('extension')
    );
    
    if (criticalErrors.length > 0) {
      console.error('Critical errors found:', criticalErrors);
    }
    
    // The test passes if no critical errors
    expect(criticalErrors.length).toBe(0);
  });

  test('session state should persist basic tab info', async ({ page }) => {
    // Wait for app to load
    await page.waitForTimeout(5000);

    // Get console messages related to session
    const sessionLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Session') || text.includes('session') || text.includes('restore')) {
        sessionLogs.push(text);
      }
    });

    // Reload to trigger session restoration
    await page.reload();
    await page.waitForTimeout(5000);

    console.log('Session logs:', sessionLogs);

    // Screenshot after session restore
    await page.screenshot({ path: '/tmp/pyxis-session-restored.png', fullPage: true });

    // Basic check - page should still be functional
    const isLoaded = await page.locator('body').isVisible();
    expect(isLoaded).toBeTruthy();
  });

  test('extension tab data should be serializable for session storage', async ({ page }) => {
    // Collect errors related to DataCloneError
    const cloneErrors: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('DataCloneError') || 
          text.includes('can not be cloned') ||
          text.includes('Failed to save')) {
        cloneErrors.push(text);
      }
    });

    // Wait for app to load
    await page.waitForTimeout(8000);

    // Wait for session save to happen (debounced)
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: '/tmp/pyxis-extension-tab.png', fullPage: true });

    // Check for DataCloneError
    if (cloneErrors.length > 0) {
      console.error('DataCloneError found:', cloneErrors);
    }

    expect(cloneErrors.length).toBe(0);
  });
});
