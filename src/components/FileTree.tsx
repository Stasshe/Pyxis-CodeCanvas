import { FolderOpen, File, Folder } from 'lucide-react';
import { FileItem } from '../types';

interface FileTreeProps {
  items: FileItem[];
  onFileOpen: (file: FileItem) => void;
  level?: number;
}

export default function FileTree({ items, onFileOpen, level = 0 }: FileTreeProps) {
  return (
    <>
      {items.map(item => (
        <div key={item.id} style={{ marginLeft: `${level * 16}px` }}>
          <div
            className="flex items-center gap-2 px-2 py-1 hover:bg-accent cursor-pointer select-none"
            onClick={() => onFileOpen(item)}
          >
            {item.type === 'folder' ? (
              <Folder size={16} className="text-blue-400" />
            ) : (
              <File size={16} className="text-gray-400" />
            )}
            <span className="text-sm truncate">{item.name}</span>
          </div>
          {item.children && (
            <FileTree 
              items={item.children} 
              onFileOpen={onFileOpen} 
              level={level + 1} 
            />
          )}
        </div>
      ))}
    </>
  );
}
