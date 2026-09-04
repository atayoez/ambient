import { useAnimationSpeed } from '../lib/appHooks';
import { formatSpeed, SPEED_MAX, SPEED_MIN, SPEED_STEP } from '../lib/live';
import { ControlRow } from '../ui';

// The global animation-speed slider. One control, two homes — the Patterns
// pane (next to the pattern knobs, while Animate is on) and Settings →
// Desktop — both bound to Settings.animationSpeed through useAnimationSpeed:
// the value moves instantly wherever it is shown (and in the live preview),
// is persisted once the drag settles, and the active live wallpaper is
// re-applied so the desktop follows. Every animation reads the same number:
// the WebGL shaders (accumulated time × speed, so it glides), the emoji
// drift/spin (CSS durations ÷ speed), and the Plasma plugin's shader clock,
// emoji field, and Ken Burns still drift (speedFactor).
export default function SpeedSlider({ label = 'Speed' }: { label?: string }) {
  const [speed, setSpeed] = useAnimationSpeed();
  return (
    <ControlRow
      label={label}
      value={speed}
      min={SPEED_MIN}
      max={SPEED_MAX}
      step={SPEED_STEP}
      format={formatSpeed}
      onChange={setSpeed}
    />
  );
}
