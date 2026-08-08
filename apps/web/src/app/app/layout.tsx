import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";

import { productAuth } from "@/components/product-auth";
import { TrialRunShell } from "@/components/trialrun-shell";

export default async function AppLayout({ children }: { readonly children: React.ReactNode }) {
  const auth = await productAuth();
  if (!auth) redirect("/login?auth=required");

  return (
    <TrialRunShell
      csrfToken={auth.csrfToken}
      user={{ displayName: auth.user.displayName, email: auth.user.email }}
    >
      <nav
        aria-label="Workspace settings"
        className="flex h-9 items-stretch justify-end border-b border-border px-4 sm:px-5 lg:px-9"
      >
        <Link className="product-nav-link" href="/app/settings">
          <Settings2 aria-hidden="true" className="size-3.5" />
          Settings
        </Link>
      </nav>
      {children}
    </TrialRunShell>
  );
}
