import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';

// Fullscreen video / GIF for a `{ kind: "video" }` live wallpaper — used by
// the desktop-layer window (LiveWallpaper) and the Patterns preview, so both
// play the clip the same way: looped, muted, cover-cropped, and sped up or
// slowed down by the global animation speed (playbackRate / no-op for GIF).
// The file is an imported copy in the app's data dir, inside the asset
// protocol scope, streamed through convertFileSrc.
export default function VideoFill({
  path,
  format,
  speed = 1,
  className,
}: {
  path: string;
  format?: 'gif' | 'video';
  speed?: number;
  className?: string;
}) {
  const src = convertFileSrc(path);
  const gif = format ? format === 'gif' : /\.gif$/i.test(path);
  const videoRef = useRef<HTMLVideoElement>(null);

  // playbackRate isn't a React prop; set it on the element (and again on
  // every source change, which resets it to 1).
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = Math.max(0.0625, speed);
  }, [speed, src]);

  const style = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  } as const;
  if (gif) return <img src={src} alt="" className={className} style={style} />;
  return (
    <video
      ref={videoRef}
      src={src}
      className={className}
      style={style}
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      onLoadedMetadata={(e) => {
        e.currentTarget.playbackRate = Math.max(0.0625, speed);
      }}
    />
  );
}
