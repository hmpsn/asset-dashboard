import { useState, useCallback, useRef } from 'react';
import { Upload, Image, FileImage } from 'lucide-react';
import { cn } from '../lib/utils';
import { themeColor } from './ui/constants';
import { postForm } from '../api/client';

interface Props {
  workspaceId: string;
  type: 'asset' | 'meta';
  disabled?: boolean;
}

export function DropZone({ workspaceId, type, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!workspaceId || files.length === 0) return;

    setUploading(true);
    setLastCount(null);

    const formData = new FormData();
    for (const file of Array.from(files)) {
      formData.append('files', file);
    }

    const endpoint = type === 'meta'
      ? `/api/upload/${workspaceId}/meta`
      : `/api/upload/${workspaceId}`;

    try {
      const data = await postForm<{ uploaded: number }>(endpoint, formData);
      setLastCount(data.uploaded);
      setTimeout(() => setLastCount(null), 3000);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [workspaceId, type]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    uploadFiles(e.dataTransfer.files);
  }, [disabled, uploadFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const Icon = type === 'meta' ? FileImage : Image;

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      className={cn(
        'relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer min-h-[180px]',
        disabled && 'opacity-40 cursor-not-allowed',
        dragging ? 'scale-[1.01]' : '',
        uploading && 'border-emerald-500/50 bg-emerald-500/5'
      )}
      style={!uploading ? {
        borderColor: dragging ? '#2dd4bf' : themeColor('#3f3f46', '#cbd5e1'),
        backgroundColor: dragging ? 'rgba(45,212,191,0.1)' : themeColor('#18181b', '#ffffff'),
      } : undefined}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.svg"
        onChange={handleFileSelect}
        className="hidden"
      />

      {uploading ? (
        <>
          <div className="w-8 h-8 border-2 rounded-full animate-spin border-zinc-700 border-t-teal-400" />
          <p className="text-sm text-zinc-400">Processing...</p>
        </>
      ) : lastCount !== null ? (
        <>
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Upload className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-sm text-emerald-400 font-medium">
            {lastCount} file{lastCount !== 1 ? 's' : ''} sent to pipeline
          </p>
        </>
      ) : (
        <>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-teal-500/10">
            <Icon className="w-5 h-5 text-teal-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-200">
              {type === 'meta' ? 'Meta / OG Images' : 'Assets'}
            </p>
            <p className="text-xs mt-1 text-zinc-500">
              {type === 'meta'
                ? 'Optimized JPEG — keeps format for social sharing'
                : 'Converts to AVIF, minifies SVGs'}
            </p>
          </div>
          <p className="text-xs text-zinc-500">Drop files or click to browse</p>
        </>
      )}
    </div>
  );
}
