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
    icon: Code,
    title: "Understand the change",
    copy: "Codex reads the exact base and pull request source, the diff, and the repository's own instructions before it tests anything.",
  },
  {
    icon: GitBranch,
    title: "Boot both commits",
    copy: "Zerops runs the exact base and pull request privately, with separate dependencies and data for each side.",
  },
  {
    icon: Camera,
    title: "Prove live behavior",
    copy: "Codex uses live Chrome against both apps while TrialRun records matched assertions, screenshots, video, logs, and code lines.",
  },
] as const;

const architectureSteps = [
  {
    icon: GithubLogo,
    title: "Repository",
    copy: "Exact GitHub SHAs and a setup approved by your team",
  },
  {
    icon: GitBranch,
    title: "Two app worlds",
    copy: "Private base and PR deployments, each with its own data and dependencies",
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
              <p className="mb-7 text-[15px] font-medium text-black/58">
                Evidence-backed pull request review
              </p>
              <h1 className="text-[clamp(3.1rem,6.2vw,6rem)] leading-[0.94] font-semibold tracking-[-0.065em] text-balance">
                Let Codex run the change before you merge it.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-7 text-black/62 sm:text-xl sm:leading-8">
                Codex reads the change. Zerops privately boots the exact base and pull request.
                Chrome tests both live. TrialRun posts the evidence to GitHub, then deletes the
                exact temporary project.
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
                You approve the detected setup once. TrialRun generates the private review
                environment without changing your repository configuration.
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
            <div className="absolute inset-x-5 bottom-5 rounded-xl border border-white/35 bg-white/94 p-4 shadow-[0_20px_60px_rgba(24,20,55,0.25)] backdrop-blur-md sm:inset-x-auto sm:right-7 sm:bottom-7 sm:w-[430px] sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold">One review, end to end</p>
                <span className="rounded-full bg-[#e9edff] px-2.5 py-1 text-xs font-medium text-[#264bd7]">
                  Exact base ↔ PR
                </span>
              </div>
              <div className="mt-4 grid grid-cols-[24px_1fr] gap-x-3 gap-y-3.5 text-[13px] leading-5 text-black/65">
                <MagnifyingGlass
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-[#2357ff]"
                  weight="duotone"
                />
                <p>
                  <span className="font-semibold text-black">Codex understands the code.</span> It
                  reads the exact source and change.
                </p>
                <GitBranch
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-[#6347c7]"
                  weight="duotone"
                />
                <p>
                  <span className="font-semibold text-black">Zerops boots both commits.</span> Base
                  and pull request stay private and isolated.
                </p>
                <Browsers
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-[#d91383]"
                  weight="duotone"
                />
                <p>
                  <span className="font-semibold text-black">Live Chrome proves behavior.</span>{" "}
                  Every action and observation is recorded.
                </p>
                <GithubLogo
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-[#111111]"
                  weight="duotone"
                />
                <p>
                  <span className="font-semibold text-black">TrialRun delivers the proof.</span>{" "}
                  GitHub gets the evidence, then the exact project is deleted.
                </p>
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
                The agent stays live while the app is running. It can follow unexpected behavior and
                connect the runtime evidence back to the code that caused it.
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
                <span>Evidence path</span>
                <span>One durable review record</span>
              </div>
              <div className="space-y-0 px-4 py-3 sm:px-6">
                {[
                  ["Understand", "Exact source, diff, and repository instructions"],
                  ["Prove", "Matched base and pull request browser evidence"],
                  ["Decide", "Independent assertions determine the verdict"],
                  ["Deliver", "GitHub evidence plus exact-project teardown proof"],
                ].map(([verb, copy], index) => (
                  <div
                    className="grid grid-cols-[80px_1fr] gap-3 border-b border-white/8 py-5 text-sm last:border-b-0"
                    key={verb}
                  >
                    <span className={index === 2 ? "text-[#ff78c7]" : "text-[#7e9dff]"}>
                      {verb}
                    </span>
                    <span className="text-white/78">{copy}</span>
                  </div>
                ))}
              </div>
              <div className="grid border-t border-white/10 sm:grid-cols-2">
                <div className="p-5 sm:border-r sm:border-white/10">
                  <p className="text-xs text-white/60">GitHub output</p>
                  <p className="mt-2 text-lg font-medium">Check and concise PR comment</p>
                </div>
                <div className="border-t border-white/10 p-5 sm:border-t-0">
                  <p className="text-xs text-white/60">Cleanup contract</p>
                  <p className="mt-2 flex items-center gap-2 text-lg font-medium">
                    <Trash aria-hidden="true" className="size-5 text-[#ff78c7]" weight="duotone" />
                    Exact project deletion recorded
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
                TrialRun turns your existing app setup into two private deployments.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-black/58">
                Run a setup check, review the detected apps and commands, then approve them once.
                TrialRun handles the Zerops configuration for every base and pull request run.
              </p>
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
          Connect a repository, run its setup check, approve how TrialRun will run it, and let every
          pull request earn its evidence.
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
