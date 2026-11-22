import React, { useEffect, useState } from 'react';
import { Mic, Shield, Users } from 'lucide-react';
import { playMcClick } from '../utils/mcSound';

const SPLASH_LINES = [
  'Browser Voice Chat!',
  'No Mod Required!',
  'Drop-In Group Codes!',
  'Temporary VCs!',
  'Invite Your Squad!',
];

interface TitleLoginScreenProps {
  onSignIn: () => Promise<void>;
  signingIn: boolean;
  error: string | null;
}

export const TitleLoginScreen: React.FC<TitleLoginScreenProps> = ({
  onSignIn,
  signingIn,
  error,
}) => {
  const [splashIndex, setSplashIndex] = useState(0);
  const [bgFailed, setBgFailed] = useState(false);
  const [emblemFailed, setEmblemFailed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSplashIndex((prev) => (prev + 1) % SPLASH_LINES.length);
    }, 3600);
    return () => window.clearInterval(timer);
  }, []);

  const handleLoginClick = () => {
    playMcClick();
    onSignIn();
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0D0F12] flex flex-col justify-between">
      {/* Panorama Backdrop */}
      {!bgFailed ? (
        <img
          src="/src/assets/images/minecraft_panorama_bg_1795361101638.jpg"
          alt="Voxel sunrise valley panorama"
          referrerPolicy="no-referrer"
          onError={() => setBgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover mc-panorama-motion opacity-80 select-none pointer-events-none"
        />
      ) : (
        <div className="absolute inset-0 mc-deepslate-bg" />
      )}

      {/* Measured Scrim for 4.5:1+ WCAG Contrast */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/45 to-black/90 pointer-events-none" />

      {/* Top Navigation Bar (3-Zone Contract) */}
      <header className="relative z-10 flex items-center justify-between gap-8 px-6 lg:px-12 py-5 border-b border-white/10 bg-black/35 backdrop-blur-xs">
        <div className="flex items-center gap-3 shrink-0">
          {!emblemFailed ? (
            <img
              src="/src/assets/images/velkox_emblem_1795361100969.jpg"
              alt="Velkox VC Emblem"
              referrerPolicy="no-referrer"
              onError={() => setEmblemFailed(true)}
              className="w-8 h-8 border-2 border-black object-cover shrink-0"
            />
          ) : (
            <div className="w-8 h-8 bg-[#3C8527] border-2 border-black flex items-center justify-center">
              <Mic className="w-4 h-4 text-white" />
            </div>
          )}
          <span className="font-pixel text-lg text-white whitespace-nowrap shrink-0">
            Velkox VC
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#D0D6E0]">
          <a href="#features" className="hover:text-white hover:underline whitespace-nowrap shrink-0">
            Features
          </a>
          <a href="#how-it-works" className="hover:text-white hover:underline whitespace-nowrap shrink-0">
            Group Codes
          </a>
          <a href="#voice-controls" className="hover:text-white hover:underline whitespace-nowrap shrink-0">
            Temporary VCs
          </a>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={handleLoginClick}
            disabled={signingIn}
            className="mc-btn-emerald px-4 py-2 font-pixel text-xs whitespace-nowrap shrink-0 cursor-pointer"
          >
            {signingIn ? 'Signing In...' : 'Sign In'}
          </button>
        </div>
      </header>

      {/* Center Minecraft Java Title Lockup */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="max-w-2xl w-full flex flex-col items-center">
          <div className="relative inline-block mb-4">
            <h1 className="font-pixel text-4xl sm:text-6xl text-white tracking-tight drop-shadow-[0_6px_0_#1a1d24] text-balance">
              VELKOX VC
            </h1>
            <span className="hidden sm:inline-block absolute -right-24 -bottom-3 -rotate-12 font-pixel text-xs text-[#FFFF55] drop-shadow-[2px_2px_0_#3F3F00] whitespace-nowrap">
              {SPLASH_LINES[splashIndex]}
            </span>
          </div>

          <p className="text-base sm:text-lg text-[#E2E7F0] max-w-xl leading-relaxed mb-8 drop-shadow">
            Standalone Minecraft Java Edition style voice chat in your browser.
            Create groups, join with an invite code, spin up temporary voice
            channels with full owner controls, and invite group members directly
            into your call.
          </p>

          {/* Primary Java Edition Button Stack */}
          <div className="mc-panel p-6 sm:p-7 w-full max-w-md space-y-4">
            <button
              type="button"
              onClick={handleLoginClick}
              disabled={signingIn}
              className="mc-btn-emerald w-full py-3.5 px-6 flex items-center justify-center gap-3 font-pixel text-sm cursor-pointer"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#FFFFFF"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                />
              </svg>
              <span>{signingIn ? 'Connecting Account...' : 'Sign In with Google'}</span>
            </button>

            {error && (
              <div className="mc-slot p-3 text-xs text-[#FF7777] text-left">
                {error}
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-[#A3ACB9]">
              <span>No Minecraft Mod</span>
              <span aria-hidden="true">·</span>
              <span>Browser WebRTC Audio</span>
              <span aria-hidden="true">·</span>
              <span>Instant Group Codes</span>
            </div>
          </div>
        </div>

        {/* 3-Column Feature Strip */}
        <section
          id="features"
          className="mt-14 max-w-5xl w-full grid grid-cols-1 md:grid-cols-3 gap-5 text-left"
        >
          <div id="how-it-works" className="mc-panel p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-[#55FF55]">
              <Users className="w-5 h-5 shrink-0" />
              <h2 className="font-pixel text-sm text-white">Group Codes</h2>
            </div>
            <p className="text-sm text-[#B8C0CC] leading-relaxed">
              Create your own server voice group and share its 6-character code,
              or join an existing crew in seconds.
            </p>
          </div>

          <div id="voice-controls" className="mc-panel p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-[#55FFFF]">
              <Shield className="w-5 h-5 shrink-0" />
              <h2 className="font-pixel text-sm text-white">Temporary VCs</h2>
            </div>
            <p className="text-sm text-[#B8C0CC] leading-relaxed">
              Spin up a temporary voice channel anytime. Lock doors, server-mute,
              kick, rename, or transfer VC ownership.
            </p>
          </div>

          <div className="mc-panel p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-[#FFAA00]">
              <Mic className="w-5 h-5 shrink-0" />
              <h2 className="font-pixel text-sm text-white">Direct Invites</h2>
            </div>
            <p className="text-sm text-[#B8C0CC] leading-relaxed">
              Even if you aren&apos;t the group owner, you can create your own
              temporary VC and invite group members straight into it.
            </p>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="relative z-10 px-6 lg:px-12 py-4 border-t border-white/10 bg-black/50 flex flex-wrap items-center justify-between gap-4 text-xs text-[#9AA3B2]">
        <span>Velkox VC · Browser Voice Chat for Minecraft Java Players</span>
        <span>Not an official Minecraft product · Not affiliated with Mojang</span>
      </footer>
    </div>
  );
};
