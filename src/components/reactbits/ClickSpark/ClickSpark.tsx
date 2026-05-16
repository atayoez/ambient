// Adapted from React Bits (MIT + Commons Clause)
// https://github.com/DavidHDev/react-bits — src/ts-default/Animations/ClickSpark/ClickSpark.tsx
// See THIRD_PARTY_LICENSES.md for the full notice.
//
// Two intentional deviations from upstream marked with `// ambient:`:
//   1. Wrapper uses `display: inline-flex` (not 100%/100%) so it sizes to its
//      child — Ambient uses ClickSpark per-button, not as a whole-app overlay.
//   2. `sparkColor` defaults to 'currentColor' and resolves against the
//      wrapper's computed color at click time, so sparks auto-adapt to
//      dark/light theme without callers passing the right hex per theme.

import { useCallback, useEffect, useRef } from 'react';

interface ClickSparkProps {
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  extraScale?: number;
  children?: React.ReactNode;
}

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

const ClickSpark: React.FC<ClickSparkProps> = ({
  // ambient: 'currentColor' triggers the getComputedStyle resolution below.
  sparkColor = 'currentColor',
  sparkSize = 8,
  sparkRadius = 14,
  sparkCount = 8,
  duration = 400,
  easing = 'ease-out',
  extraScale = 1.0,
  children,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeCanvas = () => {
      const { width, height } = parent.getBoundingClientRect();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(resizeCanvas, 100);
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(parent);
    resizeCanvas();

    return () => {
      ro.disconnect();
      clearTimeout(resizeTimeout);
    };
  }, []);

  const easeFunc = useCallback(
    (t: number) => {
      switch (easing) {
        case 'linear':
          return t;
        case 'ease-in':
          return t * t;
        case 'ease-in-out':
          return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        default:
          return t * (2 - t);
      }
    },
    [easing],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const draw = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      sparksRef.current = sparksRef.current.filter((spark: Spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= duration) return false;

        const progress = elapsed / duration;
        const eased = easeFunc(progress);
        const distance = eased * sparkRadius * extraScale;
        const lineLength = sparkSize * (1 - eased);

        const x1 = spark.x + distance * Math.cos(spark.angle);
        const y1 = spark.y + distance * Math.sin(spark.angle);
        const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
        const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);

        ctx.strokeStyle = sparkColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        return true;
      });

      animationId = requestAnimationFrame(draw);
    };

    animationId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationId);
  }, [sparkColor, sparkSize, sparkRadius, sparkCount, duration, easeFunc, extraScale]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ambient: skip the spark when the click landed on a disabled <button>.
    // The button's own onClick won't fire in that case, so showing tactile
    // feedback would be misleading.
    const target = e.target as HTMLElement;
    if (target.closest?.('button:disabled')) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // ambient: resolve 'currentColor' to the wrapper's actual inherited color
    // at click time, so the next animation frame draws with the right hex.
    // Without this, canvas would interpret the literal string 'currentColor'
    // as an invalid color and draw nothing.
    if (sparkColor === 'currentColor' && wrapperRef.current) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const computed = getComputedStyle(wrapperRef.current).color;
        ctx.strokeStyle = computed;
      }
    }

    const now = performance.now();
    const newSparks: Spark[] = Array.from({ length: sparkCount }, (_, i) => ({
      x,
      y,
      angle: (2 * Math.PI * i) / sparkCount,
      startTime: now,
    }));
    sparksRef.current.push(...newSparks);
  };

  return (
    <div
      ref={wrapperRef}
      // ambient: inline-flex (not block 100%/100%) so the wrapper sizes to its
      // child button. The canvas overlays exactly the button's bounding box.
      style={{ display: 'inline-flex', position: 'relative' }}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      {children}
    </div>
  );
};

export default ClickSpark;
