import "server-only";

import { cache } from "react";

import { currentAuth } from "@/lib/auth";

/** Request-scoped memoization keeps the app layout and leaf page on one auth read. */
export const productAuth = cache(currentAuth);
