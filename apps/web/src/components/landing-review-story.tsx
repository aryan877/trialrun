import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  BracketsCurly,
  Browser,
  Check,
  Database,
  FileMagnifyingGlass,
  GithubLogo,
  HardDrives,
  Pulse,
  ShieldCheck,
  TerminalWindow,
  Trash,
  VideoCamera,
} from "@phosphor-icons/react/ssr";

const repositoryClues = [
  "App entrypoints and routes",
  "Build and start commands",
  "Database and service clients",
  "Existing tests and env names",
] as const;

const safetyChecks = [
  "Every choice cites the commit",
  "Only supported Zerops services",
  "Private ports and test-only env",
  "Hard CPU, RAM and service limits",
] as const;

const liveTools = [
  { icon: BracketsCurly, label: "Read code" },
  { icon: Browser, label: "Drive Chrome" },
  { icon: Pulse, label: "Test APIs" },
  { icon: TerminalWindow, label: "Read logs" },
] as const;

function StepArrow() {
  return (
    <span
      aria-hidden="true"
      className="absolute -right-4 bottom-7 z-10 hidden size-8 items-center justify-center rounded-full border border-black/12 bg-white text-black lg:flex"
    >
      <ArrowRight className="size-4" weight="bold" />
    </span>
  );
}

function BrandLabel({
  mark,
  name,
  step,
}: {
  readonly mark: "github" | `/brand/${string}.svg`;
  readonly name: string;
  readonly step: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white p-2 shadow-[0_6px_18px_rgba(17,17,17,0.06)]">
        {mark === "github" ? (
          <GithubLogo aria-hidden="true" className="size-[26px]" weight="fill" />
        ) : (
          <Image alt="" aria-hidden="true" height={26} src={mark} width={26} />
        )}
      </span>
      <div>
        <p className="text-xs text-black/45">{step}</p>
        <p className="text-sm font-semibold text-black">{name}</p>
      </div>
    </div>
  );
}

export function RepositoryToLabStory() {
  return (
    <section className="border-b border-black/10 bg-white" id="how-it-works">
      <span className="absolute" id="zerops" />
      <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-base font-medium text-[#2357ff]">The repository is the setup</p>
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] font-semibold tracking-[-0.055em] text-balance sm:text-6xl">
              Codex figures out what must run.
            </h2>
          </div>
          <div className="max-w-2xl lg:justify-self-end">
            <p className="text-lg leading-8 text-black/62">
              Install the TrialRun GitHub App and choose a repository. There is no fixed manifest
              list and no customer Zerops file. Codex explores the full, exact commit until it can
              explain the apps, data services, build commands, ports, and tests. A maintainer
              approves one plain summary.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#eef1ff] px-4 py-2 text-sm font-semibold text-[#173eb8]">
              <Check aria-hidden="true" className="size-4" weight="bold" />
              Example: Run the web app with PostgreSQL. Test its UI and API.
            </p>
          </div>
        </div>

        <div className="mt-12 overflow-hidden rounded-[22px] border border-black/14 bg-[#fbfbf8] shadow-[0_24px_70px_rgba(17,17,17,0.08)] lg:grid lg:grid-cols-[0.9fr_1.08fr_0.92fr_1.1fr]">
          <article className="relative border-b border-black/12 p-6 sm:p-8 lg:border-r lg:border-b-0">
            <BrandLabel mark="github" name="Exact GitHub commit" step="Start here" />
            <h3 className="mt-8 text-2xl font-semibold tracking-[-0.035em]">
              One read-only source
            </h3>
            <div className="mt-5 overflow-hidden rounded-xl bg-[#111111] text-white">
              <div className="flex h-9 items-center gap-1.5 border-b border-white/10 px-4">
                <span className="size-2 rounded-full bg-[#ff3ca6]" />
                <span className="size-2 rounded-full bg-[#c7ff63]" />
                <span className="size-2 rounded-full bg-[#65dcff]" />
                <code className="ml-auto font-mono text-[10px] text-white/42">exact SHA</code>
              </div>
              <ul className="space-y-3 px-4 py-5">
                {repositoryClues.map((clue) => (
                  <li className="flex items-center gap-2.5 text-[13px] text-white/72" key={clue}>
                    <span className="size-1.5 shrink-0 rounded-full bg-white/36" />
                    {clue}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-5 text-sm leading-6 text-black/52">
              TrialRun blocks credentials, generated folders, unsafe links, and oversized files.
            </p>
            <StepArrow />
          </article>

          <article className="relative border-b border-black/12 bg-[#fff0f8] p-6 sm:p-8 lg:border-r lg:border-b-0">
            <BrandLabel mark="/brand/openai.svg" name="Codex explores" step="Then" />
            <h3 className="mt-8 text-2xl font-semibold tracking-[-0.035em]">
              Follow the code, not a checklist
            </h3>
            <div className="relative mt-6 grid min-h-48 place-items-center overflow-hidden rounded-xl border border-[#ff3ca6]/35 bg-white/65 p-5">
              <span className="absolute top-4 left-4 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium">
                entrypoints
              </span>
              <span className="absolute top-5 right-4 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium">
                data
              </span>
              <span className="absolute bottom-4 left-5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium">
                tests
              </span>
              <span className="absolute right-5 bottom-5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium">
                runtime
              </span>
              <div className="relative flex size-24 items-center justify-center rounded-full border-2 border-[#ff3ca6] bg-[#ff3ca6] shadow-[0_10px_32px_rgba(255,60,166,0.25)]">
                <span className="flex size-16 items-center justify-center rounded-full bg-white">
                  <FileMagnifyingGlass
                    aria-hidden="true"
                    className="size-8 text-[#8c155a]"
                    weight="duotone"
                  />
                </span>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-black/58">
              It can search any safe file, trace callers, and keep reading until the run plan is
              clear.
            </p>
            <StepArrow />
          </article>

          <article className="relative border-b border-black/12 bg-[#eef1ff] p-6 sm:p-8 lg:border-r lg:border-b-0">
            <BrandLabel
              mark="/brand/trialrun.svg"
              name="TrialRun checks"
              step="Before cloud spend"
            />
            <h3 className="mt-8 text-2xl font-semibold tracking-[-0.035em]">Safe enough to boot</h3>
            <ul className="mt-5 divide-y divide-[#2357ff]/14 rounded-xl border border-[#2357ff]/20 bg-white">
              {safetyChecks.map((check) => (
                <li
                  className="flex min-h-12 items-center gap-3 px-4 text-[13px] font-medium"
                  key={check}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#c7ff63] text-black">
                    <Check aria-hidden="true" className="size-3" weight="bold" />
                  </span>
                  {check}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm leading-6 text-black/58">
              TrialRun generates the Zerops service setup: build, start, ports, health checks,
              private links, and hard resource limits. Codex never gets the cloud key.
            </p>
            <StepArrow />
          </article>

          <article className="bg-[#eafcf8] p-6 sm:p-8">
            <BrandLabel mark="/brand/zerops.svg" name="Zerops builds the lab" step="Live result" />
            <h3 className="mt-8 text-2xl font-semibold tracking-[-0.035em]">
              One private lab per PR
            </h3>
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-[#02b3a4]/24 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Current app</span>
                  <span className="size-2 rounded-full bg-[#02b3a4]" />
                </div>
                <p className="mt-1 text-xs text-black/50">Running today · its own data</p>
              </div>
              <div className="rounded-xl border border-[#ff3ca6]/28 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">Pull request app</span>
                  <span className="size-2 rounded-full bg-[#ff3ca6]" />
                </div>
                <p className="mt-1 text-xs text-black/50">Proposed change · separate data</p>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-[#111111] p-4 text-white">
                <Image alt="" aria-hidden="true" height={24} src="/brand/chrome.svg" width={24} />
                <div>
                  <p className="text-sm font-semibold">Chrome + API executor</p>
                  <p className="mt-0.5 text-xs text-white/48">One private Zerops network</p>
                </div>
              </div>
            </div>
          </article>
        </div>

        <div className="mt-7 flex flex-col gap-3 text-sm text-black/54 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-5 text-[#2357ff]" weight="duotone" />
            The model recommends. TrialRun enforces the limits and owns deployment.
          </p>
          <p className="inline-flex items-center gap-2 font-medium text-black/72">
            TrialRun generates the Zerops files. The developer writes none.
          </p>
        </div>
      </div>
    </section>
  );
}

function LiveApp({ side }: { readonly side: "Current app" | "Proposed app" }) {
  const isHead = side === "Proposed app";
  return (
    <div className="relative">
      <div
        className={`overflow-hidden rounded-2xl border bg-white text-black shadow-[0_18px_48px_rgba(0,0,0,0.18)] ${isHead ? "border-[#ff3ca6]" : "border-black/16"}`}
      >
        <div className="flex h-11 items-center gap-2 border-b border-black/10 px-4">
          <Image alt="" aria-hidden="true" height={20} src="/brand/chrome.svg" width={20} />
          <span className="text-xs font-semibold">{side}</span>
          <span className="ml-auto rounded-full bg-[#eafcf8] px-2 py-1 text-[10px] font-semibold text-[#087b72]">
            ready
          </span>
        </div>
        <div className="p-4">
          <div className="rounded-lg border border-black/8 bg-[#fbfbf8] p-4">
            <div className="h-3 w-20 rounded-full bg-black/12" />
            <div className="mt-5 h-7 w-3/4 rounded-md bg-black/8" />
            <div className="mt-2 h-7 w-1/2 rounded-md bg-black/6" />
            <div
              className={`mt-5 h-9 w-28 rounded-md ${isHead ? "bg-[#ff3ca6]" : "bg-[#2357ff]"}`}
            />
          </div>
        </div>
      </div>
      <div className="mx-auto flex w-[82%] items-center justify-between gap-3 rounded-b-xl border-x border-b border-white/12 bg-white/6 px-4 py-3 text-white/66">
        <span className="inline-flex items-center gap-2 text-xs font-medium">
          <Database aria-hidden="true" className="size-4" weight="duotone" />
          Separate data
        </span>
        <span className="font-mono text-[10px] text-white/34">private</span>
      </div>
    </div>
  );
}

export function LiveInvestigationStory() {
  return (
    <section className="border-b border-white/10 bg-[#111111] text-white">
      <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-base font-medium text-[#ff8acb]">The review happens live</p>
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] font-semibold tracking-[-0.055em] text-balance sm:text-6xl">
              The same Codex opens both apps.
            </h2>
          </div>
          <p className="max-w-2xl text-lg leading-8 text-white/62 lg:justify-self-end">
            Codex starts with the code, then tests its theory against the running base and pull
            request. If the UI surprises it, it can inspect the API, read the logs, return to the
            code, and try again.
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-[24px] border border-white/14 bg-[#19191c] shadow-[0_28px_90px_rgba(0,0,0,0.32)]">
          <div className="grid gap-7 p-5 sm:p-8 lg:grid-cols-[1fr_0.72fr_1fr] lg:items-center lg:gap-8 lg:p-10">
            <LiveApp side="Current app" />

            <div className="relative order-first lg:order-none">
              <div className="absolute top-1/2 -left-12 hidden w-12 border-t border-dashed border-white/24 lg:block" />
              <div className="absolute top-1/2 -right-12 hidden w-12 border-t border-dashed border-white/24 lg:block" />
              <div className="rounded-2xl border border-[#ff3ca6]/55 bg-[#fff0f8] p-5 text-black shadow-[0_18px_48px_rgba(255,60,166,0.12)]">
                <div className="flex items-center gap-3 border-b border-black/10 pb-4">
                  <span className="flex size-11 items-center justify-center rounded-full bg-white">
                    <Image
                      alt=""
                      aria-hidden="true"
                      height={27}
                      src="/brand/openai.svg"
                      width={27}
                    />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">One Codex thread</p>
                    <p className="mt-0.5 text-xs text-black/50">Code context stays with the test</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {liveTools.map(({ icon: Icon, label }) => (
                    <div
                      className="flex min-h-16 flex-col justify-between rounded-lg border border-black/10 bg-white p-3"
                      key={label}
                    >
                      <Icon aria-hidden="true" className="size-5 text-[#8c155a]" weight="duotone" />
                      <span className="mt-3 text-xs font-semibold">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mx-auto mt-3 flex w-[88%] items-center justify-center gap-2 rounded-xl border border-[#c7ff63]/32 bg-[#c7ff63]/12 px-4 py-3 text-center text-xs font-semibold text-[#d9ffa0]">
                <Pulse aria-hidden="true" className="size-4" weight="bold" />
                Observe, act, verify, adapt
              </div>
            </div>

            <LiveApp side="Proposed app" />
          </div>

          <div className="grid border-t border-white/10 sm:grid-cols-3">
            <div className="border-b border-white/10 p-5 sm:border-r sm:border-b-0 sm:p-6">
              <p className="text-sm font-semibold text-[#65dcff]">Same question</p>
              <p className="mt-2 text-sm leading-6 text-white/56">
                Codex can repeat one interaction or HTTP call against the current and proposed apps.
              </p>
            </div>
            <div className="border-b border-white/10 p-5 sm:border-r sm:border-b-0 sm:p-6">
              <p className="text-sm font-semibold text-[#ff8acb]">Different behavior</p>
              <p className="mt-2 text-sm leading-6 text-white/56">
                It explains the difference in the context of the code that caused it.
              </p>
            </div>
            <div className="p-5 sm:p-6">
              <p className="text-sm font-semibold text-[#c7ff63]">Recorded proof</p>
              <p className="mt-2 text-sm leading-6 text-white/56">
                Screenshots, real WebM, API facts, network errors, and logs stay tied to the exact
                run.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const deliverySteps = [
  {
    icon: VideoCamera,
    title: "Save the evidence",
    copy: "TrialRun records Chrome, screenshots, API facts, and logs inside the Zerops lab.",
  },
  {
    icon: BracketsCurly,
    title: "Codex writes the verdict",
    copy: "Its pass, fail, or inconclusive answer cites real code lines and recorded proof.",
  },
  {
    icon: Trash,
    title: "Delete the exact lab",
    copy: "TrialRun waits for Zerops to finish deletion, then confirms that project ID is gone.",
  },
  {
    icon: GithubLogo,
    title: "Publish to GitHub",
    copy: "The Check and PR comment arrive with the verdict, video, hashes, and cleanup result.",
  },
] as const;

export function EvidenceDeliveryStory() {
  return (
    <section className="border-b border-black/10 bg-[#c7ff63] text-[#111111]" id="evidence">
      <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-base font-medium text-[#315b00]">
              The lab is temporary. The proof is not.
            </p>
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] font-semibold tracking-[-0.055em] text-balance sm:text-6xl">
              GitHub hears about it after cleanup.
            </h2>
          </div>
          <p className="max-w-2xl text-lg leading-8 text-black/62 lg:justify-self-end">
            TrialRun saves the useful evidence, destroys the exact Zerops project, proves it is
            gone, and only then publishes Codex&apos;s review. A forgotten preview cannot look like
            a completed run.
          </p>
        </div>

        <ol className="relative mt-12 overflow-hidden rounded-[22px] border border-black/15 bg-[#fbfbf8] shadow-[0_22px_70px_rgba(30,58,0,0.12)] lg:grid lg:grid-cols-4">
          {deliverySteps.map(({ icon: Icon, title, copy }, index) => (
            <li
              className="relative border-b border-black/12 p-6 last:border-b-0 sm:p-8 lg:border-r lg:border-b-0 lg:last:border-r-0"
              key={title}
            >
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-full bg-[#111111] text-white">
                  <Icon aria-hidden="true" className="size-5" weight="duotone" />
                </span>
                <span className="font-mono text-xs text-black/38">0{index + 1}</span>
              </div>
              <h3 className="mt-10 text-xl font-semibold tracking-[-0.03em]">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-black/58">{copy}</p>
              {index < deliverySteps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="mt-6 flex items-center gap-2 text-black/30 lg:absolute lg:top-1/2 lg:-right-3 lg:z-10 lg:mt-0 lg:-translate-y-1/2"
                >
                  <ArrowDown className="size-4 lg:hidden" weight="bold" />
                  <span className="hidden size-6 items-center justify-center rounded-full border border-black/12 bg-white lg:flex">
                    <ArrowRight className="size-3" weight="bold" />
                  </span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        <div className="mt-7 flex flex-col gap-3 text-sm text-black/58 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-2">
            <HardDrives aria-hidden="true" className="size-5" weight="duotone" />
            TrialRun keeps evidence metadata in PostgreSQL and the files in Zerops object storage.
          </p>
          <p className="inline-flex items-center gap-2 font-semibold text-black/72">
            <GithubLogo aria-hidden="true" className="size-5" weight="fill" />
            Review where the team already works
          </p>
        </div>
      </div>
    </section>
  );
}
