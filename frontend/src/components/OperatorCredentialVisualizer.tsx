import React, { useState, useEffect } from 'react';
import { Shield, Fingerprint, QrCode, Cpu, CheckCircle2, Lock, Radio, KeyRound } from 'lucide-react';
import { UserRole } from '../types';

interface OperatorCredentialVisualizerProps {
  name: string;
  email: string;
  role: UserRole | string;
  facility: string;
  passwordStrength: number;
}

export const OperatorCredentialVisualizer: React.FC<OperatorCredentialVisualizerProps> = ({
  name,
  email,
  role,
  facility,
  passwordStrength,
}) => {
  const [cipherHex, setCipherHex] = useState('0x7F8E...3B4D');
  const [badgeNum, setBadgeNum] = useState('CE-9402');

  // Randomize hex cipher slightly to create dynamic cryptostream effect
  useEffect(() => {
    const interval = setInterval(() => {
      const chars = '0123456789ABCDEF';
      let hex = '0x';
      for (let i = 0; i < 4; i++) hex += chars[Math.floor(Math.random() * 16)];
      hex += '...';
      for (let i = 0; i < 4; i++) hex += chars[Math.floor(Math.random() * 16)];
      setCipherHex(hex);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  // Compute initials
  const initials = name
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'CE';

  return (
    <div
      id="operator-credential-visualizer"
      className="h-full w-full bg-[#08080a] flex flex-col justify-between p-3.5 sm:p-4 text-white relative select-none overflow-hidden"
    >
      {/* Background Matrix Grid Pattern in orange/white */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #f97316 1.2px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Sweeping CRT Scanline Overlay */}
      <div className="absolute inset-x-0 h-16 pointer-events-none bg-gradient-to-b from-transparent via-orange-500/[0.08] to-transparent animate-scanline z-20" />

      {/* Top Header */}
      <div className="relative z-10 pb-2 border-b border-white/[0.1] flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shadow-[0_0_6px_rgba(249,115,22,0.8)]" />
            <span className="text-[10px] font-mono font-bold tracking-widest text-white uppercase">
              CREDENTIAL GENERATOR
            </span>
          </div>
          <div className="text-[9px] font-mono text-[#8c8c8c] mt-0.2">
            ISO 27001 CCTV ACCESS MATRIX
          </div>
        </div>

        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-orange-500/15 text-orange-400 border border-orange-500/30 font-semibold shadow-[0_0_8px_rgba(249,115,22,0.2)]">
          CLEARANCE L3
        </span>
      </div>

      {/* Center: Dynamic Holographic Operator Access Badge */}
      <div className="my-auto py-1 relative z-10 flex-1 flex flex-col justify-center min-h-0">
        <div className="w-full max-w-[320px] mx-auto rounded-xl border border-orange-500/30 bg-gradient-to-br from-white/[0.1] via-black/60 to-orange-500/[0.08] backdrop-blur-md p-3 shadow-2xl relative overflow-hidden">
          {/* Holographic animated shimmer across badge */}
          <div className="absolute inset-0 pointer-events-none animate-holographic" />

          {/* Badge Top Notch & Chip */}
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.1]">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-4 rounded-xs bg-gradient-to-r from-orange-400 to-amber-300 border border-orange-500/60 flex items-center justify-center shadow-xs">
                <Cpu className="w-2.5 h-2.5 text-black" />
              </div>
              <span className="text-[9px] font-mono text-white/80 font-bold tracking-wider">
                CAMEYE® ENCLAVE
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold text-orange-400 tracking-widest">
              {badgeNum}
            </span>
          </div>

          {/* Badge Photo & Info Row */}
          <div className="flex items-center gap-2.5 my-2.5">
            {/* Holographic Avatar Box */}
            <div className="w-11 h-11 rounded-lg bg-black border-2 border-orange-500/50 flex items-center justify-center font-bold text-[15px] text-white tracking-tight relative shadow-inner shrink-0">
              <span>{initials}</span>
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-orange-500 border border-black flex items-center justify-center shadow-[0_0_6px_rgba(249,115,22,0.8)]">
                <CheckCircle2 className="w-2 h-2 text-black" />
              </div>
            </div>

            {/* Operator Meta */}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-white tracking-tight truncate">
                {name || 'Prospective Operator'}
              </div>
              <div className="text-[10px] text-[#a3a3a3] truncate font-mono">
                {email || 'operator@cameye.internal'}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 truncate">
                  {role}
                </span>
                <span className="text-[9px] font-mono text-white/60 truncate">
                  {facility || 'HQ Sector'}
                </span>
              </div>
            </div>
          </div>

          {/* Barcode & Hologram Security Strip */}
          <div className="pt-2 border-t border-white/[0.1] flex items-center justify-between">
            {/* Simulated Barcode Lines */}
            <div className="flex items-center gap-[1.5px] h-4.5 opacity-75">
              {[2, 4, 1, 3, 2, 5, 1, 2, 4, 3, 1, 4, 2, 3, 1, 2, 5, 2, 3, 1].map((w, i) => (
                <div
                  key={i}
                  className="bg-white h-full"
                  style={{ width: `${w}px`, opacity: i % 2 === 0 ? 0.9 : 0.4 }}
                />
              ))}
            </div>

            <div className="text-right">
              <div className="text-[8px] font-mono text-white/50 uppercase">RTSP Auth</div>
              <div className="text-[9.5px] font-mono text-orange-300 font-semibold">{cipherHex}</div>
            </div>
          </div>
        </div>

        {/* Biometric Verification Pulse Box */}
        <div className="mt-2.5 p-2 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative w-6 h-6 rounded bg-black border border-orange-500/40 flex items-center justify-center text-orange-400 overflow-hidden">
              <Fingerprint className="w-3.5 h-3.5" />
              {/* Animated Laser Beam */}
              <div className="absolute inset-x-0 h-0.5 bg-orange-500 shadow-[0_0_8px_#f97316] animate-laser" />
            </div>
            <div>
              <div className="text-[10px] font-mono font-semibold text-white">
                Biometric Handshake
              </div>
              <div className="text-[9px] text-[#8c8c8c] font-mono">
                {passwordStrength >= 3
                  ? 'Key entropy: High (Zero-Knowledge)'
                  : 'Key entropy: Standard (Awaiting submit)'}
              </div>
            </div>
          </div>

          <div className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
        </div>
      </div>

      {/* Bottom Network Topology Status */}
      <div className="relative z-10 pt-2 border-t border-white/[0.1] shrink-0">
        <div className="flex items-center justify-between text-[10px] font-mono text-[#8c8c8c] mb-1.5">
          <span>FACILITY ALLOCATION</span>
          <span className="text-orange-400 font-semibold">SYNCED 22 CH</span>
        </div>

        {/* 4 Interactive node chips */}
        <div className="grid grid-cols-2 gap-1.5 text-[9.5px] font-mono">
          <div className="p-1.5 rounded bg-white/[0.04] border border-white/[0.08] flex items-center justify-between hover:border-orange-500/40 transition-colors">
            <span className="text-white/80">Main Campus HQ</span>
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_4px_rgba(249,115,22,0.8)]" />
          </div>
          <div className="p-1.5 rounded bg-white/[0.04] border border-white/[0.08] flex items-center justify-between hover:border-orange-500/40 transition-colors">
            <span className="text-white/80">Warehouse Hub</span>
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_4px_rgba(249,115,22,0.8)]" />
          </div>
          <div className="p-1.5 rounded bg-white/[0.04] border border-white/[0.08] flex items-center justify-between hover:border-orange-500/40 transition-colors">
            <span className="text-white/80">Server Vault 4B</span>
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_4px_rgba(249,115,22,0.8)]" />
          </div>
          <div className="p-1.5 rounded bg-white/[0.04] border border-white/[0.08] flex items-center justify-between hover:border-orange-500/40 transition-colors">
            <span className="text-white/80">Air Patrol Drone</span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-[#8c8c8c]">
          <span className="flex items-center gap-1">
            <Shield className="w-2.5 h-2.5 text-orange-400" />
            <span>Encrypted Storage</span>
          </span>
          <span>Gateway 443</span>
        </div>
      </div>
    </div>
  );
};
