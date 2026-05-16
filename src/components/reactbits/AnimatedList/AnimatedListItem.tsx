// Extracted from React Bits' AnimatedList (MIT + Commons Clause).
// https://github.com/DavidHDev/react-bits — src/ts-default/Components/AnimatedList/AnimatedList.tsx
// See THIRD_PARTY_LICENSES.md for the full notice.
//
// Upstream AnimatedList is a full scroll-list widget with arrow-key
// navigation, gradient fades, and string-only item rendering. Ambient
// only needs the inner per-item stagger animation, applied to its own
// custom card grid. This file extracts that — the AnimatedItem helper
// — with two deviations:
//
//   1. `style={{ marginBottom: '1rem', cursor: 'pointer' }}` from
//      upstream is dropped. Library uses `gap` on its grid for spacing
//      and the clickable affordance lives on the inner button, not the
//      wrapper.
//   2. `useInView(... once: false)` becomes `once: true` so the scale
//      + fade only runs on first appearance. Cards scrolling back into
//      view shouldn't re-animate — that reads as a bug, not a feature.

import { motion, useInView } from 'motion/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';

interface AnimatedListItemProps {
  children: ReactNode;
  /** Stagger offset in seconds — typically `index * 0.04`. */
  delay?: number;
}

export default function AnimatedListItem({ children, delay = 0 }: AnimatedListItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5, once: true });

  return (
    <motion.div
      ref={ref}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.85, opacity: 0 }}
      transition={{ duration: 0.25, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
