import Image from "next/image";
import Link from "next/link";
import { ArrowRight, GithubLogo, ShieldCheck, Trash } from "@phosphor-icons/react/ssr";

import { LandingProof } from "@/components/landing-proof";
import {
  EvidenceDeliveryStory,
  LiveInvestigationStory,
  RepositoryToLabStory,
} from "@/components/landing-review-story";
import { publicRuntimeContent } from "@/components/public-runtime";
import { PublicFooter, PublicHeader } from "@/components/public-site";
import { publicAuth } from "@/lib/auth";

const reviewRoles = [
  {
    image: "/brand/openai.svg",
    name: "Codex maps the whole repository",
    copy: "It follows entrypoints, data clients, build scripts, and tests to work out what must run.",
  },
  {
    image: "/brand/zerops.svg",
    name: "Zerops boots both versions",
    copy: "The current and proposed apps run privately with separate data.",
  },
  {
    image: "/brand/chrome.svg",
    name: "Codex tests UI, APIs, and logs",
    copy: "It drives both apps live and follows the evidence back into the code.",
  },
] as const;

export default async function Home() {
  const auth = await publicAuth();
  const workspaceHref = auth ? "/app" : "/login?mode=register";
  const { proof } = publicRuntimeContent(process.env);

  return (
    <main className="public-page min-h-dvh bg-[#fbfbf8] text-[#111111]">
      <PublicHeader signedIn={Boolean(auth)} />

      <section className="border-b border-black/10">
        <div className="mx-auto grid max-w-[1440px] lg:min-h-[calc(100dvh-72px)] lg:grid-cols-[0.88fr_1.12fr]">
          <div className="flex items-center px-5 py-12 sm:px-8 sm:py-20 lg:px-12 lg:py-12 xl:px-16">
            <div className="max-w-[640px]">
              <p className="mb-7 text-[15px] font-medium text-black/55">
                From GitHub repository to live proof
              </p>
              <h1 className="text-[clamp(3.2rem,6vw,5.75rem)] leading-[0.94] font-semibold tracking-[-0.065em] text-balance">
                Know what the PR breaks.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-7 text-black/62 sm:text-xl sm:leading-8">
                Connect GitHub. Codex maps the repository and decides what must run. TrialRun turns
                that into a checked Zerops setup. Zerops starts the current app and the proposed
                change with separate data. The same Codex thread investigates both through code,
                Chrome, HTTP, and logs, then posts the recorded proof.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex h-13 items-center justify-center rounded-md bg-[#111111] px-6 text-[15px] font-semibold text-white transition-transform hover:-translate-y-px hover:bg-black focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:ring-offset-2 focus-visible:outline-none"
                  href={workspaceHref}
                >
                  {auth ? "Open workspace" : "Connect a repository"}
                  <ArrowRight aria-hidden="true" className="ml-2 size-[18px]" weight="bold" />
                </Link>
                <a
                  className={`${proof ? "hidden sm:inline-flex" : "inline-flex"} h-13 items-center justify-center rounded-md border border-black/18 bg-white px-6 text-[15px] font-semibold transition-colors hover:border-black/40 hover:bg-[#f3f3ef] focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:outline-none`}
                  href={proof ? proof.reviewUrl : "#evidence"}
                >
                  {proof ? "Open the real review" : "See the proof contract"}
                </a>
              </div>
              <p className="mt-5 hidden max-w-lg items-start gap-2 text-sm leading-6 text-black/52 sm:flex">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 size-[18px] shrink-0"
                  weight="duotone"
                />
                Codex owns the review and verdict. TrialRun&apos;s normal code owns GitHub access,
                Zerops setup, proof checks, and cleanup.
              </p>
            </div>
          </div>

          <div
            className={`relative overflow-hidden border-t border-black/10 bg-[#3869ff] lg:min-h-0 lg:border-t-0 lg:border-l ${proof ? "min-h-[890px] sm:min-h-[650px]" : "min-h-[650px]"}`}
          >
            <Image
              alt="An original grain-textured field behind the TrialRun review loop"
              className="object-cover"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 56vw"
              src="/brand/trialrun-evidence-field-v1.jpg"
            />
            <div className="absolute inset-5 flex items-start sm:inset-8 sm:items-center lg:inset-10 xl:inset-12">
              {proof ? (
                <LandingProof proof={proof} />
              ) : (
                <div className="w-full overflow-hidden rounded-xl border border-white/45 bg-white/94 shadow-[0_28px_90px_rgba(32,24,82,0.28)] backdrop-blur-md">
                  <div className="flex min-h-14 items-center justify-between gap-4 border-b border-black/10 px-5">
                    <p className="text-sm font-semibold">How one real review runs</p>
                    <span className="text-xs font-medium text-black/48">
                      Waiting for live proof
                    </span>
                  </div>
                  <div className="divide-y divide-black/10">
                    {reviewRoles.map((role) => (
                      <div className="grid grid-cols-[42px_1fr] gap-4 px-5 py-4" key={role.name}>
                        <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-white p-2">
                          <Image
                            alt=""
                            aria-hidden="true"
                            height={28}
                            src={role.image}
                            width={28}
                          />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{role.name}</p>
                          <p className="mt-0.5 text-[13px] leading-5 text-black/52">{role.copy}</p>
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-[42px_1fr] gap-4 bg-[#111111] px-5 py-4 text-white">
                      <div className="flex size-10 items-center justify-center rounded-md border border-white/14 bg-white/8">
                        <GithubLogo aria-hidden="true" className="size-6" weight="fill" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Codex writes the review</p>
                        <p className="mt-0.5 text-[13px] leading-5 text-white/52">
                          GitHub gets the Check and evidence links. The review keeps proof that its
                          exact Zerops project is gone.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div
                    className="border-t border-black/10 bg-[#fff0f8] px-5 py-3 text-xs leading-5 text-[#8c155a]"
                    role="status"
                  >
                    This space stays empty until one live review publishes both recordings, its
                    GitHub Check, and exact-project deletion proof.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <RepositoryToLabStory />

      <LiveInvestigationStory />

      <EvidenceDeliveryStory />

      <section className="border-b border-black/10 bg-[#ffd8ee]">
        <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:px-12 lg:py-24">
          <div>
            <Image alt="" aria-hidden="true" height={38} src="/brand/openai.svg" width={38} />
            <p className="mt-7 text-base font-medium text-[#8c155a]">Choose your Codex</p>
            <h2 className="mt-4 max-w-lg text-4xl leading-[1.03] font-semibold tracking-[-0.05em] sm:text-5xl">
              Use ours. Or bring yours.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-black/60">
              Each review uses one Codex connection from code reading through live UI, API, and log
              investigation. You choose which connection TrialRun uses.
            </p>
          </div>
          <div className="border-t border-black/16">
            <article className="grid gap-4 border-b border-black/16 py-7 sm:grid-cols-[0.4fr_0.6fr] sm:gap-8">
              <h3 className="text-xl font-semibold tracking-[-0.025em]">TrialRun-managed Codex</h3>
              <p className="text-sm leading-6 text-black/62">
                Choose it and run. There is nothing else to authorize, and the same review limits
                apply from repository analysis through live UI, API, and log testing.
              </p>
            </article>
            <article className="grid gap-4 border-b border-black/16 py-7 sm:grid-cols-[0.4fr_0.6fr] sm:gap-8">
              <h3 className="text-xl font-semibold tracking-[-0.025em]">Your Codex subscription</h3>
              <p className="text-sm leading-6 text-black/62">
                Connect the subscription you already use. You authorize it inside a private Zerops
                workspace tied to your account, and its login never enters the app being tested.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="bg-[#111111] px-5 py-20 text-center text-white sm:px-8 lg:py-24">
        <Trash aria-hidden="true" className="mx-auto size-8 text-[#ff8acb]" weight="duotone" />
        <h2 className="mx-auto mt-5 max-w-3xl text-4xl leading-[1.03] font-semibold tracking-[-0.05em] sm:text-6xl">
          Run the change. Keep the proof. Delete the rest.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-white/60">
          Connect one repository and let its next pull request face the product it changes.
        </p>
        <Link
          className="mt-8 inline-flex h-13 items-center justify-center rounded-md bg-[#c7ff63] px-6 text-[15px] font-semibold text-[#10120d] hover:bg-[#d5ff8b] focus-visible:ring-2 focus-visible:ring-[#ff8acb] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111111] focus-visible:outline-none"
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
