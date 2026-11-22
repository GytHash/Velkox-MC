import React from 'react';
import { SkinPreset } from '../types';

export const SKIN_PALETTES: Record<
  SkinPreset,
  { label: string; hair: string; skin: string; eyes: string; accent: string }
> = {
  steve: {
    label: 'Classic Builder',
    hair: '#4A2F1D',
    skin: '#C89675',
    eyes: '#3B48A8',
    accent: '#8D5E45',
  },
  emerald: {
    label: 'Emerald Villager',
    hair: '#1D5E2A',
    skin: '#96D49B',
    eyes: '#193D1F',
    accent: '#55FF55',
  },
  diamond: {
    label: 'Diamond Knight',
    hair: '#1B7B8C',
    skin: '#AEE8F0',
    eyes: '#163740',
    accent: '#55FFFF',
  },
  redstone: {
    label: 'Redstone Engineer',
    hair: '#781818',
    skin: '#D6A69E',
    eyes: '#FF5555',
    accent: '#AA0000',
  },
  gold: {
    label: 'Golden Piglin',
    hair: '#9E6E14',
    skin: '#F5CB6C',
    eyes: '#3D2707',
    accent: '#FFAA00',
  },
  obsidian: {
    label: 'Obsidian Sentinel',
    hair: '#14111C',
    skin: '#3B344F',
    eyes: '#AA55FF',
    accent: '#231D30',
  },
  amethyst: {
    label: 'Amethyst Mage',
    hair: '#5A2B82',
    skin: '#DEC9ED',
    eyes: '#7A2FC7',
    accent: '#C48CF7',
  },
  creeper: {
    label: 'Creeper Scout',
    hair: '#247824',
    skin: '#4AB848',
    eyes: '#111811',
    accent: '#184A18',
  },
};

interface MinecraftAvatarProps {
  skinPreset?: string;
  size?: number;
  speaking?: boolean;
  muted?: boolean;
  className?: string;
}

export const MinecraftAvatar: React.FC<MinecraftAvatarProps> = ({
  skinPreset = 'steve',
  size = 36,
  speaking = false,
  muted = false,
  className = '',
}) => {
  const palette = SKIN_PALETTES[(skinPreset as SkinPreset)] || SKIN_PALETTES.steve;
  const isCreeper = skinPreset === 'creeper';

  return (
    <div
      style={{ width: size, height: size }}
      className={`relative shrink-0 border-2 ${
        speaking
          ? 'border-[#55FF55] shadow-[0_0_0_2px_rgba(85,255,85,0.45)]'
          : 'border-black'
      } bg-[#13161b] select-none transition-shadow duration-150 ${className}`}
    >
      <svg
        viewBox="0 0 8 8"
        shapeRendering="crispEdges"
        className="w-full h-full block"
        aria-hidden="true"
      >
        {/* Base face */}
        <rect x="0" y="0" width="8" height="8" fill={palette.skin} />
        {/* Hair / Helmet top */}
        <rect x="0" y="0" width="8" height="2" fill={palette.hair} />
        {!isCreeper && (
          <>
            <rect x="0" y="2" width="1" height="2" fill={palette.hair} />
            <rect x="7" y="2" width="1" height="2" fill={palette.hair} />
          </>
        )}
        {/* Eyes */}
        {isCreeper ? (
          <>
            <rect x="1" y="2" width="2" height="2" fill={palette.eyes} />
            <rect x="5" y="2" width="2" height="2" fill={palette.eyes} />
            <rect x="3" y="4" width="2" height="1" fill={palette.eyes} />
            <rect x="2" y="5" width="4" height="2" fill={palette.eyes} />
            <rect x="2" y="7" width="1" height="1" fill={palette.eyes} />
            <rect x="5" y="7" width="1" height="1" fill={palette.eyes} />
          </>
        ) : (
          <>
            <rect x="1" y="4" width="1" height="1" fill="#FFFFFF" />
            <rect x="2" y="4" width="1" height="1" fill={palette.eyes} />
            <rect x="5" y="4" width="1" height="1" fill={palette.eyes} />
            <rect x="6" y="4" width="1" height="1" fill="#FFFFFF" />
            {/* Nose / Mouth */}
            <rect x="3" y="5" width="2" height="1" fill={palette.accent} />
            <rect x="2" y="6" width="4" height="1" fill={palette.accent} />
          </>
        )}
      </svg>
      {muted && (
        <span
          title="Muted"
          className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-[#A62C2C] border border-black flex items-center justify-center text-[8px] font-pixel text-white leading-none"
        >
          ×
        </span>
      )}
    </div>
  );
};
