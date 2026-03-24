import { cn } from '../../lib/utils';

interface SerpPreviewProps {
  title: string;
  description: string;
  url: string;
  siteName?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function SerpPreview({ 
  title, 
  description, 
  url, 
  siteName, 
  size = 'md',
  className 
}: SerpPreviewProps) {
  const titleSizeClasses = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl'
  };

  const descSizeClasses = {
    sm: 'text-sm',
    md: 'text-sm',
    lg: 'text-base'
  };

  return (
    <div className={cn(
      'bg-white border border-zinc-200 rounded-lg p-4 shadow-sm',
      className
    )}>
      {/* URL */}
      <div className="text-[14px] text-zinc-500 mb-1 truncate">
        {url}
      </div>
      
      {/* Title */}
      <h3 className={cn(
        'text-blue-900 font-medium mb-1 hover:underline cursor-pointer',
        titleSizeClasses[size]
      )}>
        {title || 'Untitled Page'}
      </h3>
      
      {/* Description */}
      <div className={cn(
        'text-zinc-600 leading-relaxed',
        descSizeClasses[size]
      )}>
        {description || 'No description available.'}
      </div>
      
      {/* Site attribution */}
      {siteName && (
        <div className="text-[12px] text-zinc-500 mt-2">
          {siteName}
        </div>
      )}
    </div>
  );
}
