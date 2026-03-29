import React, { useRef, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

interface ScannerRevealProps {
  children: React.ReactNode;
}

interface ContainerRect {
  top: number;
  left: number;
  right: number;  // distance from right edge of viewport
  bottom: number; // distance from bottom of viewport
  height: number;
}

export function ScannerReveal({ children }: ScannerRevealProps) {
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<ContainerRect | null>(null);

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        right: window.innerWidth - r.right,
        bottom: window.innerHeight - r.bottom,
        height: r.height,
      });
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div ref={containerRef}>
      {children}

      {rect && (
        <>
          {/* Overlay: constrained to the content container, clips away top-to-bottom */}
          <div
            key={`overlay-${location.key}`}
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              zIndex: 9998,
              backgroundColor: '#0f1219',
              animation: 'scanReveal 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
              pointerEvents: 'none',
            }}
          />

          {/* Beam: teal line that sweeps the height of the content container */}
          <div
            key={`beam-${location.key}`}
            style={{
              position: 'fixed',
              left: rect.left,
              right: rect.right,
              top: rect.top,
              height: '1px',
              zIndex: 9999,
              background: `linear-gradient(90deg,
                transparent 8%,
                rgba(45, 212, 191, 0.15) 25%,
                rgba(45, 212, 191, 0.25) 45%,
                rgba(45, 212, 191, 0.3) 50%,
                rgba(45, 212, 191, 0.25) 55%,
                rgba(45, 212, 191, 0.15) 75%,
                transparent 92%
              )`,
              boxShadow:
                '0 0 8px 2px rgba(45,212,191,0.12), 0 0 24px 4px rgba(45,212,191,0.06)',
              ['--scan-travel' as string]: `${rect.height}px`,
              animation: 'scanBeam 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
              pointerEvents: 'none',
            }}
          />
        </>
      )}
    </div>
  );
}

export default ScannerReveal;
