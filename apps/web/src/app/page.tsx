import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Browsers,
  Camera,
  CheckCircle,
  Code,
  GitBranch,
  GithubLogo,
  MagnifyingGlass,
  ShieldCheck,
  Trash,
} from "@phosphor-icons/react/ssr";

import { PublicFooter, PublicHeader } from "@/components/public-site";
import { publicAuth } from "@/lib/auth";

const processSteps = [
  {
    icon: GitBranch,
    title: "Build both commits",
    copy: "TrialRun checks out the exact base and pull request SHAs, then boots each version with its own dependencies and data.",
  },
  {
    icon: Browsers,
    title: "Give Codex the wheel",
    copy: "Codex explores the code and the live product together. It can inspect, click, type, compare, and change course as it learns.",
  },
  {
    icon: Camera,
    title: "Keep the receipts",
    copy: "A deterministic verifier ties the verdict to assertions, screenshots, console events, logs, and exact code lines.",
  },
] as const;

const architectureSteps = [
  {
    icon: GithubLogo,
    title: "Repository",
    copy: "Exact GitHub SHAs and a confirmed infrastructure recipe",
  },
  {
    icon: GitBranch,
    title: "Two app worlds",
    copy: "Separate base and PR services, data, and dependencies",
  },
  {
    icon: Browsers,
    title: "Agent + browser",
    copy: "Interactive Codex and Chrome inside the review network",
  },
  {
    icon: Trash,
    title: "Positive teardown",
    copy: "The exact owned project is verified, deleted, and recorded",
  },
] as const;

export default async function Home() {
  const auth = await publicAuth();
  const workspaceHref = auth ? "/app" : "/login?mode=register";

  return (
    <main className="public-page min-h-dvh bg-[#fbfbf8] text-[#111111]">
      <PublicHeader signedIn={Boolean(auth)} />

      <section className="border-b border-black/10">
        <div className="mx-auto grid max-w-[1440px] lg:min-h-[720px] lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex items-center px-5 py-16 sm:px-8 sm:py-20 lg:px-12 lg:py-24 xl:px-16">
            <div className="max-w-[650px]">
              <p className="mb-7 flex items-center gap-2 text-[15px] font-medium text-black/58">
                <span className="inline-block size-2 rounded-full bg-[#ff3ca6]" />
                AI pull request review, with receipts
              </p>
              <h1 className="text-[clamp(3.1rem,6.2vw,6rem)] leading-[0.94] font-semibold tracking-[-0.065em] text-balance">
                Let Codex run the change before you merge it.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-7 text-black/62 sm:text-xl sm:leading-8">
                TrialRun gives a live Codex agent two real versions of your app, a private browser,
                and the code. It finds what changed, proves it, and leaves a review your team can
                inspect.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex h-13 items-center justify-center rounded-md bg-[#111111] px-6 text-[15px] font-semibold text-white transition-transform hover:-translate-y-px hover:bg-black focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:ring-offset-2 focus-visible:outline-none"
                  href={workspaceHref}
                >
                  {auth ? "Open workspace" : "Review your first PR"}
                  <ArrowRight aria-hidden="true" className="ml-2 size-[18px]" weight="bold" />
                </Link>
                <a
                  className="inline-flex h-13 items-center justify-center rounded-md border border-black/18 bg-white px-6 text-[15px] font-semibold transition-colors hover:border-black/40 hover:bg-[#f3f3ef] focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:outline-none"
                  href="#how-it-works"
                >
                  See the review loop
                </a>
              </div>
              <p className="mt-5 flex max-w-lg items-start gap-2 text-sm leading-6 text-black/52">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" weight="duotone" />
                Your app runs in an isolated Zerops project. TrialRun records the deletion before a
                review can close.
              </p>
            </div>
          </div>

          <div className="relative min-h-[560px] overflow-hidden border-t border-black/10 bg-[#3869ff] lg:min-h-0 lg:border-t-0 lg:border-l">
            <Image
              alt="An original grain-textured illustration of two application worlds being compared"
              className="object-cover"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 55vw"
              src="/brand/trialrun-evidence-field-v1.jpg"
            />
            <div className="absolute inset-x-5 bottom-5 rounded-xl border border-white/35 bg-white/92 p-4 shadow-[0_20px_60px_rgba(24,20,55,0.25)] backdrop-blur-md sm:inset-x-auto sm:right-7 sm:bottom-7 sm:w-[390px] sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold">One live review loop</p>
                <span className="rounded-full bg-[#e9edff] px-2.5 py-1 text-xs font-medium text-[#264bd7]">
                  Base ↔ PR
                </span>
              </div>
              <div className="mt-4 grid grid-cols-[24px_1fr] gap-x-3 gap-y-3 text-[13px] leading-5 text-black/65">
                <MagnifyingGlass aria-hidden="true" className="mt-0.5 size-5 text-[#2357ff]" weight="duotone" />
                <p>Observe the DOM, repository, console, network, and service logs.</p>
                <Code aria-hidden="true" className="mt-0.5 size-5 text-[#d91383]" weight="duotone" />
                <p>Investigate freely while every action and observation is recorded.</p>
                <CheckCircle aria-hidden="true" className="mt-0.5 size-5 text-[#111111]" weight="duotone" />
                <p>Let deterministic checks—not agent confidence—decide the result.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-white" id="how-it-works">
        <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
            <div>
              <p className="text-base font-medium text-[#2357ff]">From pull request to proof</p>
              <h2 className="mt-4 max-w-md text-4xl leading-[1.03] font-semibold tracking-[-0.05em] sm:text-5xl">
                A reviewer that can actually use your product.
              </h2>
              <p className="mt-5 max-w-md text-base leading-7 text-black/58">
                This is not a generated checklist. The agent stays live while the app is running,
                follows unexpected behavior, and connects runtime evidence back to the code.
              </p>
            </div>
            <div className="grid border-t border-black/12 md:grid-cols-3 md:border-l md:border-t-0">
              {processSteps.map((step, index) => (
                <article
                  className="border-b border-black/12 py-8 md:border-r md:border-b-0 md:px-7"
                  key={step.title}
                >
                  <div className="flex items-center justify-between">
                    <step.icon aria-hidden="true" className="size-7" weight="duotone" />
                    <span className="text-sm tabular-nums text-black/60">0{index + 1}</span>
                  </div>
                  <h3 className="mt-12 text-xl font-semibold tracking-[-0.025em]">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-black/58">{step.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#111111] text-white" id="evidence">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
          <div className="px-5 py-20 sm:px-8 lg:px-12 lg:py-28 xl:px-16">
            <p className="text-base font-medium text-[#ff78c7]">The evidence is the product</p>
            <h2 className="mt-4 max-w-xl text-4xl leading-[1.03] font-semibold tracking-[-0.05em] sm:text-5xl">
              See the exact moment behavior diverged.
            </h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/62">
              TrialRun keeps a tamper-checked ledger of the live session. Every reproduced finding
              must point to recorded browser evidence and exact source lines.
            </p>
            <ul className="mt-10 grid gap-4 text-[15px] text-white/78 sm:grid-cols-2">
              {["Matched screenshots", "Browser and service logs", "Assertion results", "Code citations", "Privacy-safe artifacts", "Deletion receipt"].map(
                (item) => (
                  <li className="flex items-center gap-3" key={item}>
                    <CheckCircle aria-hidden="true" className="size-5 text-[#ff78c7]" weight="fill" />
                    {item}
                  </li>
                ),
              )}
            </ul>
          </div>
          <div className="border-t border-white/13 bg-[#18181a] p-5 sm:p-8 lg:border-t-0 lg:border-l lg:p-12">
            <div className="mx-auto max-w-xl overflow-hidden rounded-xl border border-white/14 bg-[#0c0c0d] shadow-2xl">
              <div className="flex h-12 items-center justify-between border-b border-white/10 px-4 text-xs text-white/60">
                <span>Illustrative evidence trace</span>
                <span>checkout.spec</span>
              </div>
              <div className="space-y-0 px-4 py-3 sm:px-6">
                {[
                  ["Observe", "Codex opened /checkout on both commits", "19:08:12"],
                  ["Assert", "Base total matches the expected order", "19:08:24"],
                  ["Compare", "PR total differs after delivery is applied", "19:08:39"],
                  ["Inspect", "Finding linked to pricing.ts and browser proof", "19:09:03"],
                ].map(([verb, copy, time], index) => (
                  <div
                    className="grid grid-cols-[72px_1fr_auto] gap-3 border-b border-white/8 py-5 text-sm last:border-b-0"
                    key={verb}
                  >
                    <span className={index === 2 ? "text-[#ff78c7]" : "text-[#7e9dff]"}>{verb}</span>
                    <span className="text-white/78">{copy}</span>
                    <span className="hidden font-mono text-[11px] text-white/60 sm:block">{time}</span>
                  </div>
                ))}
              </div>
              <div className="grid border-t border-white/10 sm:grid-cols-2">
                <div className="p-5 sm:border-r sm:border-white/10">
                  <p className="text-xs text-white/60">Runtime verdict</p>
                  <p className="mt-2 text-lg font-medium">Regression reproduced</p>
                </div>
                <div className="border-t border-white/10 p-5 sm:border-t-0">
                  <p className="text-xs text-white/60">Cleanup contract</p>
                  <p className="mt-2 flex items-center gap-2 text-lg font-medium">
                    <Trash aria-hidden="true" className="size-5 text-[#ff78c7]" weight="duotone" />
                    Delete exact project
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-[#eeeefe]" id="zerops">
        <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
          <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="text-base font-medium text-[#6347c7]">Built around Zerops</p>
              <h2 className="mt-4 max-w-3xl text-4xl leading-[1.03] font-semibold tracking-[-0.05em] sm:text-5xl">
                Each review gets the infrastructure its repository asks for—not a hardcoded demo.
              </h2>
            </div>
            <a
              className="inline-flex h-11 items-center justify-center rounded-md border border-black/16 bg-white/70 px-4 text-sm font-semibold hover:bg-white"
              href="https://docs.zerops.io/"
            >
              Explore Zerops
              <ArrowRight aria-hidden="true" className="ml-2 size-4" weight="bold" />
            </a>
          </div>
          <div className="mt-12 grid overflow-hidden rounded-xl border border-black/12 bg-white md:grid-cols-4">
            {architectureSteps.map((step) => (
              <article className="border-b border-black/10 p-6 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0" key={step.title}>
                <step.icon aria-hidden="true" className="size-7 text-[#6347c7]" weight="duotone" />
                <h3 className="mt-8 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-black/56">{step.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#ffddf1] px-5 py-20 text-center sm:px-8 lg:py-28">
        <h2 className="mx-auto max-w-3xl text-4xl leading-[1.03] font-semibold tracking-[-0.05em] sm:text-6xl">
          Stop asking whether the PR works. Run it.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-black/60">
          Connect a repository, confirm the proposed stack once, and let every pull request earn its
          evidence.
        </p>
        <Link
          className="mt-8 inline-flex h-13 items-center justify-center rounded-md bg-[#111111] px-6 text-[15px] font-semibold text-white hover:bg-black"
          href={workspaceHref}
        >
          {auth ? "Open workspace" : "Create your workspace"}
          <ArrowRight aria-hidden="true" className="ml-2 size-[18px]" weight="bold" />
        </Link>
      </section>

      <PublicFooter />
    </main>
  );
}
