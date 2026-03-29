import React from 'react';
import { useLocation } from 'react-router-dom';

interface ScannerRevealProps {
  children: React.ReactNode;
}

export function ScannerReveal({ children }: ScannerRevealProps) {
  const location = useLocation();

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {children}

      {/* Overlay: dark cover that clips away top-to-bottom */}
      <div
        key={`overlay-${location.key}`}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          backgroundColor: '#0f1219',
          animation: 'scanReveal 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
          pointerEvents: 'none',
        }}
      />

      {/* Beam: teal line that sweeps top-to-bottom */}
      <div
        key={`beam-${location.key}`}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '-1px',
          height: '1px',
          zIndex: 11,
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
          animation: 'scanBeam 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export default ScannerReveal;
