import { redirect } from "next/navigation";

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
      {children}
    </TrialRunShell>
  );
}
