import { useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { FileItem } from '../types';

interface FileTreeProps {
  items: FileItem[];
  onFileOpen: (file: FileItem) => void;
  level?: number;
}

export default function FileTree({ items, onFileOpen, level = 0 }: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleItemClick = (item: FileItem) => {
    if (item.type === 'folder') {
      toggleFolder(item.id);
    } else {
      onFileOpen(item);
    }
  };

  return (
    <>
      {items.map(item => {
        const isExpanded = expandedFolders.has(item.id);
        
        return (
          <div key={item.id}>
            <div
              className="flex items-center gap-1 px-2 py-1 hover:bg-accent cursor-pointer select-none"
              onClick={() => handleItemClick(item)}
              style={{ marginLeft: `${level * 16}px` }}
            >
              {item.type === 'folder' ? (
                <>
                  {isExpanded ? (
                    <ChevronDown size={14} className="text-muted-foreground" />
                  ) : (
                    <ChevronRight size={14} className="text-muted-foreground" />
                  )}
                  <Folder size={16} className="text-blue-400" />
                </>
              ) : (
                <>
                  <div className="w-3.5"></div>
                  <File size={16} className="text-gray-400" />
                </>
              )}
              <span className="text-sm truncate">{item.name}</span>
            </div>
            
            {item.type === 'folder' && item.children && isExpanded && (
              <FileTree 
                items={item.children} 
                onFileOpen={onFileOpen} 
                level={level + 1} 
              />
            )}
          </div>
        );
      })}
    </>
  );
}
