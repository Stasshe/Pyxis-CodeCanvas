/**
 * Terminal History Storage Tests
 */

import {
  saveTerminalHistory,
  getTerminalHistory,
  clearTerminalHistory,
  clearAllTerminalHistory,
} from '../src/stores/terminalHistoryStorage';

describe('Terminal History Storage', () => {
  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
  });

  afterEach(() => {
    // Clean up after each test
    sessionStorage.clear();
  });

  describe('saveTerminalHistory', () => {
    it('should save terminal history to sessionStorage', () => {
      const projectName = 'test-project';
      const history = ['command1', 'command2', 'command3'];

      saveTerminalHistory(projectName, history);

      const saved = sessionStorage.getItem('pyxis_terminal_history_test-project');
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved!)).toEqual(history);
    });

    it('should overwrite existing history', () => {
      const projectName = 'test-project';
      const history1 = ['command1', 'command2'];
      const history2 = ['command3', 'command4'];

      saveTerminalHistory(projectName, history1);
      saveTerminalHistory(projectName, history2);

      const saved = sessionStorage.getItem('pyxis_terminal_history_test-project');
      expect(JSON.parse(saved!)).toEqual(history2);
    });
  });

  describe('getTerminalHistory', () => {
    it('should retrieve saved terminal history', () => {
      const projectName = 'test-project';
      const history = ['command1', 'command2', 'command3'];

      saveTerminalHistory(projectName, history);
      const retrieved = getTerminalHistory(projectName);

      expect(retrieved).toEqual(history);
    });

    it('should return empty array if no history exists', () => {
      const retrieved = getTerminalHistory('non-existent-project');
      expect(retrieved).toEqual([]);
    });

    it('should handle different projects separately', () => {
      const project1 = 'project1';
      const project2 = 'project2';
      const history1 = ['cmd1', 'cmd2'];
      const history2 = ['cmd3', 'cmd4'];

      saveTerminalHistory(project1, history1);
      saveTerminalHistory(project2, history2);

      expect(getTerminalHistory(project1)).toEqual(history1);
      expect(getTerminalHistory(project2)).toEqual(history2);
    });
  });

  describe('clearTerminalHistory', () => {
    it('should clear history for a specific project', () => {
      const projectName = 'test-project';
      const history = ['command1', 'command2'];

      saveTerminalHistory(projectName, history);
      clearTerminalHistory(projectName);

      const retrieved = getTerminalHistory(projectName);
      expect(retrieved).toEqual([]);
    });

    it('should not affect other projects', () => {
      const project1 = 'project1';
      const project2 = 'project2';
      const history1 = ['cmd1'];
      const history2 = ['cmd2'];

      saveTerminalHistory(project1, history1);
      saveTerminalHistory(project2, history2);

      clearTerminalHistory(project1);

      expect(getTerminalHistory(project1)).toEqual([]);
      expect(getTerminalHistory(project2)).toEqual(history2);
    });
  });

  describe('clearAllTerminalHistory', () => {
    it('should clear all terminal history', () => {
      const project1 = 'project1';
      const project2 = 'project2';
      const history1 = ['cmd1'];
      const history2 = ['cmd2'];

      saveTerminalHistory(project1, history1);
      saveTerminalHistory(project2, history2);

      clearAllTerminalHistory();

      expect(getTerminalHistory(project1)).toEqual([]);
      expect(getTerminalHistory(project2)).toEqual([]);
    });

    it('should not affect non-terminal sessionStorage items', () => {
      const project1 = 'project1';
      const history1 = ['cmd1'];

      // Add terminal history
      saveTerminalHistory(project1, history1);

      // Add non-terminal item
      sessionStorage.setItem('other-key', 'other-value');

      clearAllTerminalHistory();

      // Terminal history should be cleared
      expect(getTerminalHistory(project1)).toEqual([]);

      // Other item should remain
      expect(sessionStorage.getItem('other-key')).toBe('other-value');
    });
  });
});
