'use client';

import { useState } from 'react';

type CardProps = {
  children: React.ReactNode;
  hoverable?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
  className?: string;
};

export default function Card({ children, hoverable = false, style, onClick, className }: CardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={className}
      onClick={onClick}
      onMouseEnter={hoverable ? () => setHovered(true) : undefined}
      onMouseLeave={hoverable ? () => setHovered(false) : undefined}
      style={{
        background: '#FFFFFF',
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.04)',
        boxShadow: hovered
          ? '0 4px 8px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.08)'
          : '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
