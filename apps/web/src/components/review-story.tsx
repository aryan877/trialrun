import { ArrowDown, CheckCircle2, Code2, Globe2, ScanSearch, Trash2 } from "lucide-react";

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

function StoryStep({
  detail,
  icon: Icon,
  number,
  title,
}: {
  readonly detail: string;
  readonly icon: typeof Code2;
  readonly number: number;
  readonly title: string;
}) {
  return (
    <li className="group relative grid grid-cols-[44px_minmax(0,1fr)] gap-3 border-t border-white/10 py-4 first:border-t-0 sm:grid-cols-[52px_minmax(0,1fr)] sm:py-5">
      <div className="flex size-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.045] text-signal-info sm:size-11">
        <Icon aria-hidden="true" className="size-4.5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 pt-0.5">
        <p className="text-xs text-white/42">Step {number}</p>
        <h3 className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-white sm:text-lg">
          {title}
        </h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-white/58">{detail}</p>
      </div>
    </li>
  );
}

export function ReviewStory({
  apiResponseCount,
  baseSha,
  browserToolCount,
  findingTitle,
  headSha,
  questionAnswers,
  repositoryToolCount,
  summary,
  teardownMessage,
}: {
  readonly apiResponseCount: number;
  readonly baseSha: string;
  readonly browserToolCount: number;
  readonly findingTitle?: string | undefined;
  readonly headSha: string;
  readonly questionAnswers: readonly {
    readonly answer: string;
    readonly question: string;
  }[];
  readonly repositoryToolCount: number;
  readonly summary?: string | undefined;
  readonly teardownMessage?: string | undefined;
}) {
  return (
    <section
      aria-labelledby="review-story"
      className="overflow-hidden rounded-[6px] border border-white/12 bg-[#101114] shadow-[0_24px_80px_rgba(0,0,0,.24)]"
    >
      <div className="grid border-b border-white/10 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
        <div className="p-5 sm:p-7 lg:border-r lg:border-white/10">
          <p className="text-sm font-medium text-[#c7ff63]">The review, in plain English</p>
          <h2
            className="mt-3 max-w-3xl text-3xl leading-[1.04] font-semibold tracking-[-0.045em] text-white sm:text-4xl"
            id="review-story"
          >
            Codex read it, ran it, and proved what changed.
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-white/62">
            {summary ??
              "Codex is still reading the change and testing both running commits. This story updates as each live step finishes."}
          </p>
        </div>
        <div className="flex min-h-44 flex-col justify-between bg-[linear-gradient(135deg,rgba(35,87,255,.18),rgba(255,79,163,.12))] p-5 sm:p-7">
          <ScanSearch aria-hidden="true" className="size-7 text-[#ff76bd]" />
          <div>
            <p className="text-xs text-white/46">Result</p>
            <p className="mt-2 text-xl leading-7 font-semibold tracking-[-0.025em] text-white">
              {findingTitle ?? "Live investigation in progress"}
            </p>
          </div>
        </div>
      </div>

      {questionAnswers.length > 0 ? (
        <details className="group border-b border-white/10">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-white outline-none hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:px-7 [&::-webkit-details-marker]:hidden">
            Read Codex&apos;s answers
            <ArrowDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <dl className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-2">
            {questionAnswers.map(({ answer, question }) => (
              <div className="bg-[#101114] p-5 sm:p-6" key={question}>
                <dt className="text-sm font-semibold text-white">{question}</dt>
                <dd className="mt-2 text-sm leading-6 text-white/58">{answer}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <ol className="px-5 sm:px-7">
        <StoryStep
          detail={`Codex used ${repositoryToolCount} repository reads, searches, and diff checks to understand the change before judging it.`}
          icon={Code2}
          number={1}
          title="Understood the code"
        />
        <StoryStep
          detail={`Zerops ran ${shortSha(baseSha)} and ${shortSha(headSha)} as separate live systems with separate data.`}
          icon={Globe2}
          number={2}
          title="Booted the old and new versions"
        />
        <StoryStep
          detail={`Codex completed ${browserToolCount} live browser operations and recorded ${apiResponseCount} application API responses while it investigated.`}
          icon={ScanSearch}
          number={3}
          title="Tested the real behavior"
        />
        <StoryStep
          detail={
            findingTitle
              ? `Codex wrote the verdict itself: ${findingTitle}. TrialRun only checked that its code lines and evidence IDs were real.`
              : "Codex will write the verdict after its live investigation is complete."
          }
          icon={CheckCircle2}
          number={4}
          title="Explained the result"
        />
        <StoryStep
          detail={
            teardownMessage ??
            "After copying the proof, TrialRun deletes the exact disposable Zerops project before GitHub receives the final result."
          }
          icon={Trash2}
          number={5}
          title="Removed the test lab"
        />
      </ol>
      <div className="flex items-center justify-center gap-2 border-t border-white/10 px-5 py-3 text-xs text-white/42">
        <ArrowDown aria-hidden="true" className="size-3.5" />
        TrialRun recorded the investigation automatically inside its temporary Zerops project
      </div>
    </section>
  );
}
