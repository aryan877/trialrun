import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, GithubLogo, ShieldCheck } from "@phosphor-icons/react/ssr";

import { PublicWordmark } from "@/components/public-site";
import { publicAuth } from "@/lib/auth";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function AuthField({
  id,
  label,
  name,
  type,
  autoComplete,
  placeholder,
  minLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly type: "email" | "password" | "text";
  readonly autoComplete: string;
  readonly placeholder: string;
  readonly minLength?: number;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-black/72" htmlFor={id}>
        {label}
      </label>
      <input
        autoComplete={autoComplete}
        className="h-12 w-full rounded-md border border-black/16 bg-white px-3.5 text-[15px] text-black shadow-[0_1px_0_rgba(0,0,0,0.02)] outline-none transition placeholder:text-black/35 hover:border-black/28 focus:border-[#2357ff] focus:ring-3 focus:ring-[#2357ff]/12"
        id={id}
        maxLength={type === "password" ? 128 : type === "email" ? 320 : 100}
        minLength={minLength}
        name={name}
        placeholder={placeholder}
        required
        type={type}
      />
    </div>
  );
}

export default async function LoginPage({ searchParams }: { readonly searchParams: SearchParams }) {
  const [auth, query] = await Promise.all([publicAuth(), searchParams]);
  if (auth) redirect("/app");

  const mode = firstValue(query.mode) === "register" ? "register" : "login";
  const authState = firstValue(query.auth);
  const notice =
    authState === "invalid"
      ? "That email and password did not match an account."
      : authState === "registration_failed"
        ? "We could not create that account. Check the fields or try a different email."
        : authState === "server"
          ? "TrialRun could not reach the account service. Please try again."
          : authState === "required"
            ? "Sign in to open your TrialRun workspace."
            : null;

  return (
    <main className="public-page min-h-dvh bg-white text-[#111111] lg:grid lg:grid-cols-2">
      <section className="flex min-h-dvh flex-col bg-[#fbfbf8]">
        <header className="flex h-[76px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <PublicWordmark />
          <Link
            className="inline-flex items-center gap-2 text-sm font-medium text-black/52 transition-colors hover:text-black"
            href="/"
          >
            <ArrowLeft aria-hidden="true" className="size-4" weight="bold" />
            Back to home
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8 lg:px-12">
          <div className="w-full max-w-[470px]">
            <h1 className="text-4xl font-semibold tracking-[-0.045em] sm:text-[44px]">
              {mode === "login" ? "Welcome back." : "Create your workspace."}
            </h1>
            <p className="mt-3 text-base leading-7 text-black/52">
              {mode === "login"
                ? "Sign in to review repositories, live runs, and recorded evidence."
                : "Start with an account, then choose exactly which repositories TrialRun can access."}
            </p>

            <nav
              aria-label="Account access"
              className="mt-8 grid grid-cols-2 rounded-lg bg-black/[0.055] p-1"
            >
              <Link
                aria-current={mode === "login" ? "page" : undefined}
                className={`flex h-10 items-center justify-center rounded-md text-sm font-semibold transition ${
                  mode === "login"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/60 hover:text-black"
                }`}
                href="/login"
              >
                Sign in
              </Link>
              <Link
                aria-current={mode === "register" ? "page" : undefined}
                className={`flex h-10 items-center justify-center rounded-md text-sm font-semibold transition ${
                  mode === "register"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/60 hover:text-black"
                }`}
                href="/login?mode=register"
              >
                Create account
              </Link>
            </nav>

            {notice ? (
              <div
                className={`mt-5 rounded-md border px-3.5 py-3 text-sm leading-5 ${
                  authState === "required"
                    ? "border-[#2357ff]/22 bg-[#2357ff]/6 text-[#193dbb]"
                    : "border-[#d80066]/22 bg-[#ff3ca6]/7 text-[#a4004e]"
                }`}
                role={authState === "required" ? "status" : "alert"}
              >
                {notice}
              </div>
            ) : null}

            <form
              action={mode === "login" ? "/api/auth/login" : "/api/auth/register"}
              className="mt-6 space-y-5"
              method="post"
            >
              {mode === "register" ? (
                <AuthField
                  autoComplete="name"
                  id="display-name"
                  label="Your name"
                  minLength={2}
                  name="displayName"
                  placeholder="Your name"
                  type="text"
                />
              ) : null}
              <AuthField
                autoComplete="email"
                id="email"
                label="Email"
                name="email"
                placeholder="you@company.com"
                type="email"
              />
              <AuthField
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                id="password"
                label="Password"
                minLength={12}
                name="password"
                placeholder="12 characters minimum"
                type="password"
              />
              <button
                className="flex h-12 w-full items-center justify-center rounded-md bg-[#111111] px-5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-px hover:bg-black focus-visible:ring-2 focus-visible:ring-[#2357ff] focus-visible:ring-offset-2 focus-visible:outline-none"
                type="submit"
              >
                {mode === "login" ? "Sign in" : "Create workspace"}
                <ArrowRight aria-hidden="true" className="ml-2 size-[18px]" weight="bold" />
              </button>
            </form>

            <div className="mt-7 flex items-start gap-3 border-t border-black/10 pt-6">
              <GithubLogo aria-hidden="true" className="mt-0.5 size-5 shrink-0" weight="fill" />
              <p className="text-sm leading-6 text-black/52">
                GitHub is connected after sign-in through the TrialRun GitHub App. No personal
                access token is required.
              </p>
            </div>
          </div>
        </div>

        <footer className="px-5 py-6 text-center text-xs text-black/60 sm:px-8 lg:px-12">
          Private repositories stay private. Access is limited to the repositories you select.
        </footer>
      </section>

      <aside className="relative hidden min-h-dvh overflow-hidden bg-[#3869ff] lg:block">
        <Image
          alt="An original grain-textured illustration of two application worlds being compared"
          className="object-cover"
          fill
          priority
          sizes="50vw"
          src="/brand/trialrun-evidence-field-v1.jpg"
        />
        <div className="absolute inset-x-10 bottom-10 rounded-xl border border-white/35 bg-white/92 p-5 shadow-[0_24px_70px_rgba(41,17,80,0.24)] backdrop-blur-md xl:inset-x-auto xl:right-10 xl:w-[430px]">
          <div className="flex items-start gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-6 shrink-0 text-[#2357ff]"
              weight="duotone"
            />
            <div>
              <p className="font-semibold">Your Codex. A private review environment.</p>
              <p className="mt-1 text-sm leading-6 text-black/60">
                Codex gets narrow repository and browser tools. Tested code never receives the model
                credential or TrialRun infrastructure access.
              </p>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
