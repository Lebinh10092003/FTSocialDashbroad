import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { icons as LucideIconSet } from 'lucide-react';

export type EmailLucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export function getEmailLucideIcon(name?: string): EmailLucideIcon | null {
  return (LucideIconSet as unknown as Record<string, EmailLucideIcon>)[name || ''] || null;
}

/** Converts a Lucide icon to an image data URI so the exported email can use an <img>, not unsupported inline SVG. */
export function renderEmailIconDataUri(name: string, color: string, size: number) {
  const Icon = getEmailLucideIcon(name);
  if (!Icon) return '';
  const svg = renderToStaticMarkup(
    React.createElement(Icon, {
      xmlns: 'http://www.w3.org/2000/svg',
      width: size,
      height: size,
      color,
      strokeWidth: 2,
      fill: 'none',
      'aria-hidden': 'true',
    })
  );
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}