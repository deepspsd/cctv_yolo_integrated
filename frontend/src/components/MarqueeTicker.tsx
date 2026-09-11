import React from 'react';

interface MarqueeTickerProps {
  items?: string[];
}

export const MarqueeTicker: React.FC<MarqueeTickerProps> = ({
  items = [
    'RTSP Stream Gateway',
    'Sub-200ms WebRTC',
    'Hardware H.265 Decode',
    'Credential Masking Active',
    'Automated Zone Telemetry',
    'Zero-Ingress Exposure',
  ],
}) => {
  // 4x duplicated items for seamless loop
  const quadrupledItems = [...items, ...items, ...items, ...items];

  return (
    <div
      className="relative max-w-[520px] h-[36px] overflow-hidden mx-auto my-2"
      style={{
        maskImage: 'linear-gradient(90deg, transparent 0%, black 12%, black 88%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 12%, black 88%, transparent 100%)',
      }}
    >
      <div
        className="flex items-center gap-2 whitespace-nowrap"
        style={{
          animation: 'marquee-left 30s linear infinite',
          width: 'max-content',
        }}
      >
        {quadrupledItems.map((item, idx) => (
          <span
            key={idx}
            className="text-[12px] font-medium tracking-tight text-[#6b6b6b] dark:text-[#a1a1aa] px-3.5 py-1.5 rounded-full bg-[#fbfbfb] dark:bg-[#121216] border border-black/[0.06] dark:border-white/[0.08] hover:dark:border-orange-500/40 hover:dark:text-orange-300 transition-colors select-none flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-black/20 dark:bg-orange-500/80" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
};
