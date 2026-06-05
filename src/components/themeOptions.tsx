// Shared Auto/Light/Dark theme-mode options. Rendered as the same
// SegmentedIcons toggle everywhere a ThemeMode is picked — the Patterns
// preview theme and the Library rotation-pool theme — so the control and
// its option list have a single definition instead of one per tab.

import type { ThemeMode } from '../lib/theme';
import type { SegmentedIconOption } from '../ui';
import { AutoThemeIcon, MoonIcon, SunIcon } from './Icons';

export const THEME_MODE_OPTIONS: SegmentedIconOption<ThemeMode>[] = [
  { id: 'auto', icon: <AutoThemeIcon />, label: 'Auto' },
  { id: 'light', icon: <SunIcon />, label: 'Light' },
  { id: 'dark', icon: <MoonIcon />, label: 'Dark' },
];
