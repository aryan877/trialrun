import Link from "next/link";
import { GitFork, LogOut } from "lucide-react";

import { TrialRunWordmark } from "@/components/product-ui";
import { Button } from "@/components/ui/button";

export function TrialRunShell({
  user,
  csrfToken,
  children,
}: {
  readonly user: { readonly displayName: string; readonly email: string };
  readonly csrfToken: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
        <header className="flex h-14 items-center gap-3 px-4 sm:px-5 lg:px-9">
          <Link
            className="rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/app"
          >
            <TrialRunWordmark compact />
          </Link>
          <span aria-hidden="true" className="h-4 w-px bg-border" />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Evidence control plane
          </span>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            <Button
              asChild
              className="hidden h-8 rounded-[2px] sm:inline-flex"
              size="sm"
              variant="outline"
            >
              <a href="/api/github/install">
                <GitFork aria-hidden="true" data-icon="inline-start" />
                Connect GitHub
              </a>
            </Button>
            <div className="hidden min-w-0 text-right md:block">
              <p className="max-w-48 truncate text-xs leading-4 font-medium">{user.displayName}</p>
              <p className="max-w-48 truncate text-[10px] leading-4 text-muted-foreground">
                {user.email}
              </p>
            </div>
            <form action="/api/auth/logout" method="post">
              <input name="csrf" type="hidden" value={csrfToken} />
              <Button
                aria-label="Sign out"
                className="size-8 rounded-[2px]"
                size="icon"
                title="Sign out"
                type="submit"
                variant="ghost"
              >
                <LogOut aria-hidden="true" />
              </Button>
            </form>
          </div>
        </header>
        <nav
          aria-label="Product navigation"
          className="flex h-10 items-stretch gap-1 overflow-x-auto px-4 sm:px-5 lg:px-9"
        >
          <Link className="product-nav-link" href="/app">
            Overview
          </Link>
          <Link className="product-nav-link" href="/app#repositories">
            Repositories
          </Link>
          <Link className="product-nav-link" href="/app#reviews">
            Reviews
          </Link>
          <a className="product-nav-link sm:hidden" href="/api/github/install">
            Connect GitHub
          </a>
        </nav>
      </div>
      <main className="app-canvas">{children}</main>
    </div>
  );
}
