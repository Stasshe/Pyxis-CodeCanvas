/**
 * Complex Multi-Edit Scenario Tests
 * 
 * Tests for advanced scenarios involving:
 * - Multiple files with multiple edits each
 * - Sequential edits that depend on each other
 * - Large-scale refactoring scenarios
 * - Edge cases that occur in real-world multi-file edits
 */

import {
  parseEditResponse,
  validateResponse,
  extractFilePathsFromResponse,
} from '@/engine/ai/responseParser';

describe('AI Response Parser - Complex Multi-Edit Scenarios', () => {
  describe('Multiple files with multiple edits each', () => {
    it('should handle 3 files with 5 edits each', () => {
      let response = '';
      const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
      const originalFiles = [];

      for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
        response += `### File: ${files[fileIdx]}
**Reason**: Multiple changes to file ${fileIdx + 1}

`;
        let content = '';
        for (let editIdx = 0; editIdx < 5; editIdx++) {
          const varName = `x${fileIdx}_${editIdx}`;
          content += `const ${varName} = ${editIdx};\n`;
          response += `<<<<<<< SEARCH
const ${varName} = ${editIdx};
=======
const ${varName} = ${editIdx * 10};
>>>>>>> REPLACE

`;
        }
        originalFiles.push({ path: files[fileIdx], content });
      }

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(3);
      
      // Each file should have 5 patch blocks
      for (const file of result.changedFiles) {
        expect(file.patchBlocks?.length).toBe(5);
      }
    });

    it('should handle files with varying numbers of edits', () => {
      const response = `### File: src/file1.ts
**Reason**: One edit

<<<<<<< SEARCH
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

### File: src/file2.ts
**Reason**: Three edits

<<<<<<< SEARCH
const b1 = 1;
=======
const b1 = 10;
>>>>>>> REPLACE

<<<<<<< SEARCH
const b2 = 2;
=======
const b2 = 20;
>>>>>>> REPLACE

<<<<<<< SEARCH
const b3 = 3;
=======
const b3 = 30;
>>>>>>> REPLACE

### File: src/file3.ts
**Reason**: Two edits

<<<<<<< SEARCH
const c1 = 1;
=======
const c1 = 10;
>>>>>>> REPLACE

<<<<<<< SEARCH
const c2 = 2;
=======
const c2 = 20;
>>>>>>> REPLACE`;

      const originalFiles = [
        { path: 'src/file1.ts', content: 'const a = 1;\n' },
        { path: 'src/file2.ts', content: 'const b1 = 1;\nconst b2 = 2;\nconst b3 = 3;\n' },
        { path: 'src/file3.ts', content: 'const c1 = 1;\nconst c2 = 2;\n' },
      ];

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(3);
      expect(result.changedFiles[0].patchBlocks?.length).toBe(1);
      expect(result.changedFiles[1].patchBlocks?.length).toBe(3);
      expect(result.changedFiles[2].patchBlocks?.length).toBe(2);
    });
  });

  describe('Sequential dependent edits', () => {
    it('should handle edits that modify same function multiple times', () => {
      const response = `### File: src/calc.ts
**Reason**: Progressive refinement of function

<<<<<<< SEARCH
function add(a, b) {
  return a + b;
}
=======
function add(a: number, b: number) {
  return a + b;
}
>>>>>>> REPLACE

<<<<<<< SEARCH
function add(a: number, b: number) {
  return a + b;
}
=======
function add(a: number, b: number): number {
  return a + b;
}
>>>>>>> REPLACE

<<<<<<< SEARCH
function add(a: number, b: number): number {
  return a + b;
}
=======
/**
 * Adds two numbers
 */
function add(a: number, b: number): number {
  return a + b;
}
>>>>>>> REPLACE`;

      const originalFiles = [{
        path: 'src/calc.ts',
        content: `function add(a, b) {
  return a + b;
}`
      }];

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(1);
      expect(result.changedFiles[0].patchBlocks?.length).toBe(3);
      
      // Final result should have all modifications
      expect(result.changedFiles[0].suggestedContent).toContain('Adds two numbers');
      expect(result.changedFiles[0].suggestedContent).toContain('a: number');
      expect(result.changedFiles[0].suggestedContent).toContain('): number');
    });

    it('should handle refactoring across multiple related files', () => {
      const response = `### File: src/types.ts
**Reason**: Add new type

<<<<<<< SEARCH
export type User = { name: string };
=======
export type User = { 
  name: string;
  age: number;
};
>>>>>>> REPLACE

### File: src/api.ts
**Reason**: Use updated type

<<<<<<< SEARCH
import { User } from './types';

function createUser(name: string): User {
  return { name };
}
=======
import { User } from './types';

function createUser(name: string, age: number): User {
  return { name, age };
}
>>>>>>> REPLACE

### File: src/main.ts
**Reason**: Update function call

<<<<<<< SEARCH
const user = createUser('John');
=======
const user = createUser('John', 30);
>>>>>>> REPLACE`;

      const originalFiles = [
        { path: 'src/types.ts', content: 'export type User = { name: string };' },
        { path: 'src/api.ts', content: `import { User } from './types';

function createUser(name: string): User {
  return { name };
}` },
        { path: 'src/main.ts', content: "const user = createUser('John');" },
      ];

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(3);
      
      // Verify all changes applied
      expect(result.changedFiles[0].suggestedContent).toContain('age: number');
      expect(result.changedFiles[1].suggestedContent).toContain('name: string, age: number');
      expect(result.changedFiles[2].suggestedContent).toContain("'John', 30");
    });
  });

  describe('Large-scale refactoring', () => {
    it('should handle renaming a variable across multiple locations', () => {
      const response = `### File: src/module.ts
**Reason**: Rename oldName to newName

<<<<<<< SEARCH
const oldName = 'value';
=======
const newName = 'value';
>>>>>>> REPLACE

<<<<<<< SEARCH
function process() {
  return oldName.toUpperCase();
}
=======
function process() {
  return newName.toUpperCase();
}
>>>>>>> REPLACE

<<<<<<< SEARCH
export { oldName };
=======
export { newName };
>>>>>>> REPLACE`;

      const originalFiles = [{
        path: 'src/module.ts',
        content: `const oldName = 'value';

function process() {
  return oldName.toUpperCase();
}

export { oldName };`
      }];

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(1);
      expect(result.changedFiles[0].patchBlocks?.length).toBe(3);
      
      // All instances should be renamed
      expect(result.changedFiles[0].suggestedContent).not.toContain('oldName');
      expect(result.changedFiles[0].suggestedContent).toContain('newName');
    });

    it('should handle adding imports to multiple files', () => {
      let response = '';
      const originalFiles = [];
      
      for (let i = 1; i <= 5; i++) {
        response += `### File: src/component${i}.tsx
**Reason**: Add useState import

<<<<<<< SEARCH
import React from 'react';
=======
import React, { useState } from 'react';
>>>>>>> REPLACE

`;
        originalFiles.push({
          path: `src/component${i}.tsx`,
          content: `import React from 'react';

export function Component${i}() {
  return <div>Component ${i}</div>;
}`
        });
      }

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(5);
      
      // All files should have useState import
      for (const file of result.changedFiles) {
        expect(file.suggestedContent).toContain('useState');
      }
    });
  });

  describe('Mixed operations on same file', () => {
    it('should handle additions, modifications, and deletions in one file', () => {
      const response = `### File: src/config.ts
**Reason**: Update configuration

<<<<<<< SEARCH
export const API_URL = 'http://localhost:3000';
=======
export const API_URL = process.env.API_URL || 'http://localhost:3000';
>>>>>>> REPLACE

<<<<<<< SEARCH
export const TIMEOUT = 5000;
=======
>>>>>>> REPLACE

<<<<<<< SEARCH
// Configuration ends
=======
export const RETRY_ATTEMPTS = 3;

// Configuration ends
>>>>>>> REPLACE`;

      const originalFiles = [{
        path: 'src/config.ts',
        content: `export const API_URL = 'http://localhost:3000';
export const TIMEOUT = 5000;
// Configuration ends`
      }];

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(1);
      expect(result.changedFiles[0].patchBlocks?.length).toBe(3);
      
      // Verify changes
      expect(result.changedFiles[0].suggestedContent).toContain('process.env.API_URL');
      expect(result.changedFiles[0].suggestedContent).not.toContain('TIMEOUT');
      expect(result.changedFiles[0].suggestedContent).toContain('RETRY_ATTEMPTS');
    });
  });

  describe('Real-world complex scenarios', () => {
    it('should handle React component with multiple hook additions', () => {
      const response = `### File: src/components/UserProfile.tsx
**Reason**: Add state management and effects

<<<<<<< SEARCH
import React from 'react';
=======
import React, { useState, useEffect } from 'react';
>>>>>>> REPLACE

<<<<<<< SEARCH
export function UserProfile({ userId }: { userId: string }) {
  return <div>User Profile</div>;
}
=======
export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  return <div>User Profile</div>;
}
>>>>>>> REPLACE

<<<<<<< SEARCH
export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  return <div>User Profile</div>;
}
=======
export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId).then(setUser).finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>User not found</div>;

  return <div>User Profile: {user.name}</div>;
}
>>>>>>> REPLACE`;

      const originalFiles = [{
        path: 'src/components/UserProfile.tsx',
        content: `import React from 'react';

export function UserProfile({ userId }: { userId: string }) {
  return <div>User Profile</div>;
}`
      }];

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(1);
      expect(result.changedFiles[0].patchBlocks?.length).toBe(3);
      
      // Verify all additions
      expect(result.changedFiles[0].suggestedContent).toContain('useState');
      expect(result.changedFiles[0].suggestedContent).toContain('useEffect');
      expect(result.changedFiles[0].suggestedContent).toContain('Loading...');
    });

    it('should handle API endpoint creation with types and implementation', () => {
      const response = `### File: src/types/api.ts
**Reason**: Add new API types

<<<<<<< NEW_FILE
export interface CreateUserRequest {
  name: string;
  email: string;
  age: number;
}

export interface CreateUserResponse {
  id: string;
  name: string;
  email: string;
  age: number;
  createdAt: string;
}
>>>>>>> NEW_FILE

### File: src/api/users.ts
**Reason**: Add createUser endpoint

<<<<<<< SEARCH
import { apiClient } from './client';
=======
import { apiClient } from './client';
import type { CreateUserRequest, CreateUserResponse } from '../types/api';
>>>>>>> REPLACE

<<<<<<< SEARCH
export const usersApi = {
  getUsers: () => apiClient.get('/users'),
};
=======
export const usersApi = {
  getUsers: () => apiClient.get('/users'),
  createUser: (data: CreateUserRequest): Promise<CreateUserResponse> => {
    return apiClient.post('/users', data);
  },
};
>>>>>>> REPLACE

### File: src/components/CreateUser.tsx
**Reason**: Implement user creation form

<<<<<<< NEW_FILE
import React, { useState } from 'react';
import { usersApi } from '../api/users';
import type { CreateUserRequest } from '../types/api';

export function CreateUser() {
  const [formData, setFormData] = useState<CreateUserRequest>({
    name: '',
    email: '',
    age: 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await usersApi.createUser(formData);
    console.log('Created user:', result);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input 
        type="text" 
        value={formData.name}
        onChange={e => setFormData({...formData, name: e.target.value})}
        placeholder="Name"
      />
      <input 
        type="email" 
        value={formData.email}
        onChange={e => setFormData({...formData, email: e.target.value})}
        placeholder="Email"
      />
      <input 
        type="number" 
        value={formData.age}
        onChange={e => setFormData({...formData, age: Number(e.target.value)})}
        placeholder="Age"
      />
      <button type="submit">Create User</button>
    </form>
  );
}
>>>>>>> NEW_FILE`;

      const originalFiles = [
        { path: 'src/api/users.ts', content: `import { apiClient } from './client';

export const usersApi = {
  getUsers: () => apiClient.get('/users'),
};` }
      ];

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(3);
      
      // Check new files
      const newFiles = result.changedFiles.filter(f => f.isNewFile);
      expect(newFiles.length).toBe(2);
      
      // Check modified file
      const modifiedFile = result.changedFiles.find(f => f.path === 'src/api/users.ts');
      expect(modifiedFile).toBeDefined();
      expect(modifiedFile?.suggestedContent).toContain('createUser');
      expect(modifiedFile?.suggestedContent).toContain('CreateUserRequest');
    });
  });

  describe('Stress test scenarios', () => {
    it('should handle 20 files with 10 edits each', () => {
      let response = '';
      const originalFiles = [];
      
      for (let fileIdx = 0; fileIdx < 20; fileIdx++) {
        const filePath = `src/module${fileIdx}.ts`;
        response += `### File: ${filePath}\n**Reason**: Batch edit ${fileIdx}\n\n`;
        
        let content = '';
        for (let editIdx = 0; editIdx < 10; editIdx++) {
          const varName = `var${fileIdx}_${editIdx}`;
          content += `const ${varName} = ${editIdx};\n`;
          response += `<<<<<<< SEARCH\nconst ${varName} = ${editIdx};\n=======\nconst ${varName} = ${editIdx * 100};\n>>>>>>> REPLACE\n\n`;
        }
        
        originalFiles.push({ path: filePath, content });
      }

      const validation = validateResponse(response);
      expect(validation.isValid).toBe(true);
      expect(validation.errors.length).toBe(0);

      const result = parseEditResponse(response, originalFiles);
      expect(result.changedFiles.length).toBe(20);
      
      // Each file should have 10 patch blocks
      for (const file of result.changedFiles) {
        expect(file.patchBlocks?.length).toBe(10);
      }
    });
  });

  describe('Error recovery in multi-file scenarios', () => {
    it('should parse valid files even when one file has errors', () => {
      const response = `### File: src/good1.ts
**Reason**: Valid change

<<<<<<< SEARCH
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

### File: src/bad.ts
**Reason**: Invalid - missing separator

<<<<<<< SEARCH
const b = 2;
>>>>>>> REPLACE

### File: src/good2.ts
**Reason**: Valid change

<<<<<<< SEARCH
const c = 3;
=======
const c = 30;
>>>>>>> REPLACE`;

      const validation = validateResponse(response);
      // With warnings for missing separators, validation might still be valid
      // but should have warnings
      expect(validation.warnings.length).toBeGreaterThan(0);

      const originalFiles = [
        { path: 'src/good1.ts', content: 'const a = 1;' },
        { path: 'src/bad.ts', content: 'const b = 2;' },
        { path: 'src/good2.ts', content: 'const c = 3;' },
      ];

      const result = parseEditResponse(response, originalFiles);
      
      // Should parse the two valid files
      expect(result.changedFiles.length).toBeGreaterThanOrEqual(2);
      
      const good1 = result.changedFiles.find(f => f.path === 'src/good1.ts');
      const good2 = result.changedFiles.find(f => f.path === 'src/good2.ts');
      
      expect(good1).toBeDefined();
      expect(good2).toBeDefined();
      expect(good1?.suggestedContent).toContain('const a = 10');
      expect(good2?.suggestedContent).toContain('const c = 30');
    });
  });
});
