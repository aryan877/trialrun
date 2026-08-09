import Image from "next/image";
import { ArrowRight, CheckCircle, GithubLogo } from "@phosphor-icons/react/ssr";

import type { PublicProof } from "./public-runtime";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function RecordingFrame({
  label,
  sha,
  videoUrl,
}: {
  readonly label: "Base commit" | "Pull request";
  readonly sha: string;
  readonly videoUrl: string;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-white/14 bg-[#0b0b0d] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
      <figcaption className="flex min-h-11 items-center gap-2 border-b border-white/10 px-3 text-xs text-white/70">
        <Image alt="" aria-hidden="true" height={19} src="/brand/chrome.svg" width={19} />
        <span className="font-medium text-white">{label}</span>
        <code className="ml-auto font-mono text-[11px] text-white/46">{shortSha(sha)}</code>
      </figcaption>
      <video
        aria-label={`${label} Chrome recording`}
        className="aspect-video w-full bg-black object-contain"
        controls
        muted
        playsInline
        preload="metadata"
      >
        <source src={videoUrl} type="video/webm" />
        Your browser cannot play this WebM recording.
      </video>
    </figure>
  );
}

export function LandingProof({ proof }: { readonly proof: PublicProof }) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/30 bg-[#101012] text-white shadow-[0_28px_90px_rgba(32,24,82,0.34)]">
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2 text-xs font-medium text-white/64">
          <CheckCircle aria-hidden="true" className="size-4 text-[#c7ff63]" weight="fill" />
          Real pull request proof
        </div>
        <div className="ml-auto flex items-center gap-4">
          <a
            className="inline-flex items-center text-xs font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[#ff8acb] focus-visible:outline-none"
            href={proof.githubCheckUrl}
          >
            <GithubLogo aria-hidden="true" className="mr-1.5 size-4" weight="fill" />
            GitHub Check
          </a>
          <a
            className="inline-flex items-center text-xs font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[#ff8acb] focus-visible:outline-none"
            href={proof.reviewUrl}
          >
            Full review
            <ArrowRight aria-hidden="true" className="ml-1.5 size-3.5" weight="bold" />
          </a>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <p className="max-w-2xl text-xl leading-6 font-semibold tracking-[-0.025em] sm:text-2xl sm:leading-7">
          {proof.summary}
        </p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <RecordingFrame label="Base commit" sha={proof.baseSha} videoUrl={proof.baseWebmUrl} />
          <RecordingFrame
            label="Pull request"
            sha={proof.headSha}
            videoUrl={proof.headWebmUrl}
          />
        </div>

        <dl className="mt-4 grid gap-3 border-t border-white/12 pt-4 text-xs leading-5 text-white/54 sm:grid-cols-[0.8fr_1fr_1.2fr]">
          <div>
            <dt className="font-semibold text-white/82">Code</dt>
            <dd className="mt-0.5 font-mono">
              {shortSha(proof.baseSha)} → {shortSha(proof.headSha)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-white/82">Evidence</dt>
            <dd className="mt-0.5">The same Chrome path, recorded on both apps.</dd>
          </div>
          <div>
            <dt className="font-semibold text-white/82">Teardown</dt>
            <dd className="mt-0.5">{proof.teardownSummary}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
