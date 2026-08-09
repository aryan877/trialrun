"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export function EvidenceVideo({
  className,
  label,
  muted = false,
  src,
}: {
  readonly className?: string;
  readonly label: string;
  readonly muted?: boolean;
  readonly src: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useState<1 | 2>(2);

  useEffect(() => {
    if (!video.current) return;
    video.current.defaultPlaybackRate = rate;
    video.current.playbackRate = rate;
  }, [rate]);

  return (
    <div className="relative bg-black">
      <video
        aria-label={label}
        className={cn("w-full bg-black object-contain", className)}
        controls
        muted={muted}
        onLoadedMetadata={(event) => {
          event.currentTarget.defaultPlaybackRate = rate;
          event.currentTarget.playbackRate = rate;
        }}
        playsInline
        preload="metadata"
        ref={video}
      >
        <source src={src} type="video/webm" />
        Your browser cannot play this WebM recording. <a href={src}>Open the original file</a>.
      </video>
      <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full border border-white/20 bg-black/80 p-1 text-[10px] text-white shadow-lg backdrop-blur-sm">
        <span className="px-1.5 text-white/60">Playback</span>
        {([1, 2] as const).map((speed) => (
          <button
            aria-pressed={rate === speed}
            className={cn(
              "rounded-full px-2 py-1 font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
              rate === speed ? "bg-white text-black" : "text-white/70 hover:text-white",
            )}
            key={speed}
            onClick={() => setRate(speed)}
            type="button"
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
