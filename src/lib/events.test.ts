import { describe, expect, it, vi } from 'vitest';
import { dispatch, listen } from './events';

describe('events', () => {
  it('round-trips a string payload', () => {
    const handler = vi.fn();
    const unsub = listen('wallpaper-applied', handler);
    dispatch('wallpaper-applied', '/some/path.png');
    expect(handler).toHaveBeenCalledWith('/some/path.png');
    unsub();
  });

  it('fires void events with no payload', () => {
    const handler = vi.fn();
    const unsub = listen('settings-changed', handler);
    dispatch('settings-changed');
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('unsubscribes cleanly', () => {
    const handler = vi.fn();
    const unsub = listen('settings-changed', handler);
    unsub();
    dispatch('settings-changed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes a Wallpaper detail through', () => {
    const handler = vi.fn();
    const unsub = listen('wallpaper-rotated', handler);
    const wp = { path: '/x.png', source: 'nasa-apod' as const, addedAt: 1 };
    dispatch('wallpaper-rotated', wp);
    expect(handler).toHaveBeenCalledWith(wp);
    unsub();
  });

  it('does not cross-fire between event names', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = listen('settings-changed', a);
    const unsubB = listen('library-changed', b);
    dispatch('settings-changed');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    unsubA();
    unsubB();
  });
});
