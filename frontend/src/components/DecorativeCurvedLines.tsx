import React from 'react';

interface DecorativeCurvedLinesProps {
  isDark?: boolean;
}

export const DecorativeCurvedLines: React.FC<DecorativeCurvedLinesProps> = ({ isDark = false }) => {
  const lineCount = 20;

  const borderColor = isDark ? 'rgba(249, 115, 22, 0.45)' : '#f2f2f2';
  const animName = isDark ? 'orange-line-pulse' : 'line-pulse';
  const filterStyle = isDark ? 'drop-shadow(0 0 6px rgba(255, 115, 0, 0.4))' : 'none';

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 select-none">
      {/* Dark Mode Ambient Orange Surveillance Aurora */}
      {isDark && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(249,115,22,0.12),transparent_70%)]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-[radial-gradient(ellipse_at_center,rgba(249,115,22,0.06),transparent_70%)] pointer-events-none" />
          {/* Subtle Orange Laser Sweep */}
          <div className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-orange-500/25 to-transparent animate-laser" />
        </>
      )}

      {/* Left side curved lines (hidden on <810px) */}
      <div className="hidden md:block absolute left-0 top-0 bottom-0 w-[300px]">
        {Array.from({ length: lineCount }).map((_, i) => {
          const width = 60 + i * 10;
          return (
            <div
              key={`left-line-${i}`}
              className="absolute left-0 top-0 bottom-0 transition-colors duration-300"
              style={{
                width: `${width}px`,
                borderTop: `2.5px solid ${borderColor}`,
                borderRight: `2.5px solid ${borderColor}`,
                borderBottom: `2.5px solid ${borderColor}`,
                borderTopRightRadius: '80%',
                borderBottomRightRadius: '80%',
                animationName: animName,
                animationDuration: '5s',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${i * 0.25}s`,
                filter: filterStyle,
                opacity: isDark ? 0.65 : 0.35,
              }}
            />
          );
        })}
      </div>

      {/* Right side curved lines (hidden on <810px) */}
      <div className="hidden md:block absolute right-0 top-0 bottom-0 w-[300px]">
        {Array.from({ length: lineCount }).map((_, i) => {
          const width = 60 + i * 10;
          return (
            <div
              key={`right-line-${i}`}
              className="absolute right-0 top-0 bottom-0 transition-colors duration-300"
              style={{
                width: `${width}px`,
                borderTop: `2.5px solid ${borderColor}`,
                borderLeft: `2.5px solid ${borderColor}`,
                borderBottom: `2.5px solid ${borderColor}`,
                borderTopLeftRadius: '80%',
                borderBottomLeftRadius: '80%',
                animationName: animName,
                animationDuration: '5s',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${i * 0.25}s`,
                filter: filterStyle,
                opacity: isDark ? 0.65 : 0.35,
              }}
            />
          );
        })}
      </div>

      {/* Mobile top lines (<810px) */}
      <div className="block md:hidden absolute top-0 left-0 right-0 h-[120px]">
        {Array.from({ length: 6 }).map((_, i) => {
          const height = 20 + i * 15;
          return (
            <div
              key={`top-line-${i}`}
              className="absolute top-0 left-0 right-0 mx-auto transition-colors duration-300"
              style={{
                height: `${height}px`,
                width: `${85 + i * 2}%`,
                borderLeft: `2px solid ${borderColor}`,
                borderRight: `2px solid ${borderColor}`,
                borderBottom: `2px solid ${borderColor}`,
                borderBottomLeftRadius: '80%',
                borderBottomRightRadius: '80%',
                animationName: animName,
                animationDuration: '5s',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${i * 0.25}s`,
                filter: filterStyle,
                opacity: isDark ? 0.7 : 0.4,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
