import Link from "next/link";
import { ArrowRight, GithubLogo } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

export function PublicWordmark({ inverse = false }: { readonly inverse?: boolean }) {
  return (
    <Link
      aria-label="TrialRun home"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md text-[19px] font-semibold tracking-[-0.045em] outline-none focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:ring-offset-4",
        inverse ? "text-white" : "text-[#111111]",
      )}
      href="/"
    >
      <svg aria-hidden="true" className="size-7" viewBox="0 0 32 32">
        <path d="M3 5.5h12v21H3z" fill="currentColor" />
        <path d="M17 5.5h12v21H17z" fill={inverse ? "#ff78c7" : "#2357ff"} />
        <path d="M12.5 12h7v8h-7z" fill={inverse ? "#ffc7ea" : "#ff3ca6"} />
      </svg>
      <span>trialrun</span>
    </Link>
  );
}

export function PublicHeader({ signedIn = false }: { readonly signedIn?: boolean }) {
  return (
    <header className="relative z-20 border-b border-black/10 bg-[#fbfbf8]">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center px-5 sm:px-8 lg:px-12">
        <PublicWordmark />
        <nav
          aria-label="Main navigation"
          className="ml-10 hidden items-center gap-7 text-[15px] font-medium text-black/68 md:flex"
        >
          <Link className="transition-colors hover:text-black" href="/#how-it-works">
            How it works
          </Link>
          <Link className="transition-colors hover:text-black" href="/#evidence">
            Evidence
          </Link>
          <Link className="transition-colors hover:text-black" href="/#zerops">
            Built on Zerops
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <a
            className="hidden h-10 items-center px-3 text-sm font-medium text-black/68 transition-colors hover:text-black sm:inline-flex"
            href="https://github.com/apps/trialrun-by-aryan"
          >
            <GithubLogo aria-hidden="true" className="mr-2 size-[18px]" weight="fill" />
            GitHub App
          </a>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md bg-[#111111] px-4 text-sm font-semibold text-white transition-transform hover:-translate-y-px hover:bg-black focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:ring-offset-2 focus-visible:outline-none"
            href={signedIn ? "/app" : "/login"}
          >
            {signedIn ? "Open workspace" : "Sign in"}
            <ArrowRight aria-hidden="true" className="ml-2 size-4" weight="bold" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-black/10 bg-[#fbfbf8] text-[#111111]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-9 sm:px-8 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <PublicWordmark />
          <p className="mt-3 max-w-sm text-sm leading-6 text-black/55">
            Live, evidence-backed pull request reviews in disposable Zerops environments.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-black/62">
          <a className="hover:text-black" href="https://github.com/apps/trialrun-by-aryan">
            GitHub App
          </a>
          <a className="hover:text-black" href="https://docs.zerops.io/">
            Zerops docs
          </a>
          <Link className="hover:text-black" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
