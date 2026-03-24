import { cn } from '../../lib/utils';

interface SocialPreviewProps {
  title: string;
  description: string;
  imageUrl?: string;
  siteName?: string;
  platform?: 'facebook' | 'twitter';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function SocialPreview({ 
  title, 
  description, 
  imageUrl, 
  siteName, 
  platform = 'facebook',
  size = 'md',
  className 
}: SocialPreviewProps) {
  const sizeClasses = {
    sm: 'w-[300px]',
    md: 'w-[400px]',
    lg: 'w-[500px]'
  };

  if (platform === 'twitter') {
    return (
      <div className={cn(
        'border border-zinc-200 rounded-lg p-3 bg-white',
        sizeClasses[size],
        className
      )}>
        {/* Twitter Header */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-blue-400 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">𝕏</span>
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">{siteName || 'Site Name'}</div>
            <div className="text-zinc-500 text-xs">@handle</div>
          </div>
        </div>
        
        {/* Content */}
        <div className="text-sm text-zinc-800 leading-relaxed mb-2">
          {description || 'No description available.'}
        </div>
        
        {/* Image */}
        {imageUrl && (
          <div className="rounded-lg overflow-hidden mb-2">
            <img 
              src={imageUrl} 
              alt="Preview" 
              className="w-full h-48 object-cover"
            />
          </div>
        )}
        
        {/* Title */}
        {title && (
          <div className="text-blue-600 text-sm hover:underline cursor-pointer">
            {title}
          </div>
        )}
      </div>
    );
  }

  // Facebook preview
  return (
    <div className={cn(
      'border border-zinc-200 rounded-lg overflow-hidden bg-white',
      sizeClasses[size],
      className
    )}>
      {/* Image */}
      {imageUrl && (
        <div className="w-full h-48 bg-zinc-100">
          <img 
            src={imageUrl} 
            alt="Preview" 
            className="w-full h-full object-cover"
          />
        </div>
      )}
      
      {/* Content */}
      <div className="p-3">
        {/* Site Name */}
        {siteName && (
          <div className="text-zinc-500 text-xs uppercase font-semibold mb-1">
            {siteName}
          </div>
        )}
        
        {/* Title */}
        <div className="font-semibold text-sm text-zinc-900 mb-1 hover:underline cursor-pointer">
          {title || 'Untitled Page'}
        </div>
        
        {/* Description */}
        <div className="text-xs text-zinc-600 leading-relaxed">
          {description || 'No description available.'}
        </div>
      </div>
    </div>
  );
}
