import type { ComponentChildren } from 'preact';

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true } as const;
const I = ({ children, size }: { children: ComponentChildren; size?: number }) => (
  <svg {...base} {...(size ? { width: size, height: size } : {})}>{children}</svg>
);

export const CheckIcon = ({ size }: { size?: number }) => <I size={size}><path d="M5 12.5l4.5 4.5L19 7" /></I>;
export const UploadIcon = ({ size }: { size?: number }) => <I size={size}><path d="M12 16V4m0 0L7 9m5-5l5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></I>;
export const FolderIcon = ({ size }: { size?: number }) => <I size={size}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></I>;
export const ZipIcon = ({ size }: { size?: number }) => <I size={size}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M12 3v6m-2 0h4m-2 3v2m-1 2h2" /></I>;
export const LockIcon = ({ size }: { size?: number }) => <I size={size}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></I>;
export const SunIcon = ({ size }: { size?: number }) => <I size={size}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></I>;
export const MoonIcon = ({ size }: { size?: number }) => <I size={size}><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></I>;
export const DownloadIcon = ({ size }: { size?: number }) => <I size={size}><path d="M12 4v12m0 0l-5-5m5 5l5-5" /><path d="M4 20h16" /></I>;
export const PlusIcon = ({ size }: { size?: number }) => <I size={size}><path d="M12 5v14M5 12h14" /></I>;
export const BackIcon = ({ size }: { size?: number }) => <I size={size}><path d="M15 18l-6-6 6-6" /></I>;
