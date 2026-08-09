import { describe, expect, it } from "vitest";

import { liveAgentToolAllowlists } from "./live-agent.js";

describe("live Codex tool boundary", () => {
  it("includes bounded browser, API, log, and repository tools without ambient execution", () => {
    expect(liveAgentToolAllowlists.live).toEqual([
      "review_status",
      "api_request",
      "api_request_pair",
      "api_assert",
      "browser_observe",
      "browser_navigate",
      "browser_count",
      "browser_click",
      "browser_fill",
      "browser_select",
      "browser_press",
      "browser_assert",
      "browser_checkpoint",
      "browser_checkpoint_pair",
      "browser_events",
      "browser_reset",
      "finish_review",
    ]);
    expect(liveAgentToolAllowlists.repository).toEqual([
      "application_logs",
      "repository_tree",
      "repository_changes",
      "repository_search",
      "repository_read",
      "repository_diff",
    ]);
    expect(liveAgentToolAllowlists.live).not.toEqual(
      expect.arrayContaining(["shell", "javascript", "fetch_url", "zerops_admin"]),
    );
  });
});
