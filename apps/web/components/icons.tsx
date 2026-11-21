import type { SVGProps } from 'react';

const base = (d: string) =>
  function Icon(p: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
        <path d={d} />
      </svg>
    );
  };

export const IconMic = base('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3');
export const IconWallet = base('M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7zM3 7l12-4v4M16 14h.01');
export const IconSearch = base('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3');
export const IconShield = base('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
export const IconCheck = base('M20 6 9 17l-5-5');
export const IconX = base('M18 6 6 18M6 6l12 12');
export const IconAlert = base('M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z');
export const IconClock = base('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2');
export const IconSpeaker = base('M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14');
export const IconWifiOff = base('M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 5.2-2.9M19 12.6a10 10 0 0 0-2-1.4M12 20h.01M1.4 9a16 16 0 0 1 4.7-2.9M22.6 9A16 16 0 0 0 10.7 5');
export const IconUsers = base('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8');
export const IconMessage = base('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
export const IconLock = base('M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4');
export const IconPlay = base('M6 4l14 8-14 8V4z');
