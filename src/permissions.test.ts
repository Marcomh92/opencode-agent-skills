import { describe, test, expect } from "bun:test";
import {
  matchPattern,
  mergePermissions,
  evaluateSkillPermission,
  isSkillAllowed,
} from "./permissions";
import type { PermissionRule, AgentPermissions } from "./permissions";

describe("matchPattern", () => {
  test("exact match", () => {
    expect(matchPattern("git-helper", "git-helper")).toBe(true);
  });

  test("wildcard matches everything", () => {
    expect(matchPattern("git-helper", "*")).toBe(true);
    expect(matchPattern("pdf", "*")).toBe(true);
    expect(matchPattern("", "*")).toBe(true);
  });

  test("prefix wildcard matches", () => {
    expect(matchPattern("git-helper", "git-*")).toBe(true);
    expect(matchPattern("git-status", "git-*")).toBe(true);
  });

  test("prefix wildcard does not match non-prefix", () => {
    expect(matchPattern("pdf", "git-*")).toBe(false);
    expect(matchPattern("my-git", "git-*")).toBe(false);
  });

  test("suffix wildcard matches", () => {
    expect(matchPattern("git-helper", "*-helper")).toBe(true);
    expect(matchPattern("pdf-helper", "*-helper")).toBe(true);
  });

  test("suffix wildcard does not match non-suffix", () => {
    expect(matchPattern("git", "*-helper")).toBe(false);
    expect(matchPattern("helper-git", "*-helper")).toBe(false);
  });

  test("case insensitive exact match", () => {
    expect(matchPattern("Git-Helper", "git-helper")).toBe(true);
    expect(matchPattern("GIT-HELPER", "git-helper")).toBe(true);
    expect(matchPattern("git-helper", "Git-Helper")).toBe(true);
  });

  test("case insensitive wildcard match", () => {
    expect(matchPattern("Git-Helper", "git-*")).toBe(true);
    expect(matchPattern("PDF-Helper", "*-helper")).toBe(true);
  });

  test("no match", () => {
    expect(matchPattern("git-helper", "pdf")).toBe(false);
    expect(matchPattern("abc", "def")).toBe(false);
  });

  test("mid-pattern wildcard", () => {
    expect(matchPattern("git-status-helper", "git-*-helper")).toBe(true);
    expect(matchPattern("git-helper", "git-*-helper")).toBe(false);
    expect(matchPattern("git-abc", "git-*-helper")).toBe(false);
  });

  test("special regex characters in pattern are escaped", () => {
    expect(matchPattern("git.helper", "git.helper")).toBe(true);
    expect(matchPattern("gitXhelper", "git.helper")).toBe(false);
    expect(matchPattern("git+helper", "git+helper")).toBe(true);
    expect(matchPattern("githhelper", "git+helper")).toBe(false);
  });
});

describe("mergePermissions", () => {
  test("merging two non-overlapping rulesets", () => {
    const ruleset1: PermissionRule[] = [
      { pattern: "git-*", action: "allow" },
    ];
    const ruleset2: PermissionRule[] = [
      { pattern: "pdf", action: "deny" },
    ];
    const merged = mergePermissions(ruleset1, ruleset2);
    expect(merged).toEqual([
      { pattern: "git-*", action: "allow" },
      { pattern: "pdf", action: "deny" },
    ]);
  });

  test("later ruleset overrides earlier for same pattern", () => {
    const ruleset1: PermissionRule[] = [
      { pattern: "git-*", action: "allow" },
    ];
    const ruleset2: PermissionRule[] = [
      { pattern: "git-*", action: "deny" },
    ];
    const merged = mergePermissions(ruleset1, ruleset2);
    expect(merged).toEqual([{ pattern: "git-*", action: "deny" }]);
  });

  test("merging with empty rulesets", () => {
    const ruleset1: PermissionRule[] = [
      { pattern: "git-*", action: "allow" },
    ];
    const merged1 = mergePermissions([], ruleset1);
    expect(merged1).toEqual([{ pattern: "git-*", action: "allow" }]);

    const merged2 = mergePermissions(ruleset1, []);
    expect(merged2).toEqual([{ pattern: "git-*", action: "allow" }]);

    const merged3 = mergePermissions([], []);
    expect(merged3).toEqual([]);
  });

  test("three-way merge", () => {
    const ruleset1: PermissionRule[] = [
      { pattern: "git-*", action: "allow" },
      { pattern: "pdf", action: "deny" },
    ];
    const ruleset2: PermissionRule[] = [
      { pattern: "git-*", action: "ask" },
    ];
    const ruleset3: PermissionRule[] = [
      { pattern: "docker", action: "allow" },
    ];
    const merged = mergePermissions(ruleset1, ruleset2, ruleset3);
    expect(merged).toEqual([
      { pattern: "git-*", action: "ask" },
      { pattern: "pdf", action: "deny" },
      { pattern: "docker", action: "allow" },
    ]);
  });

  test("later override in three-way merge", () => {
    const ruleset1: PermissionRule[] = [
      { pattern: "*", action: "allow" },
    ];
    const ruleset2: PermissionRule[] = [
      { pattern: "git-*", action: "deny" },
    ];
    const ruleset3: PermissionRule[] = [
      { pattern: "git-*", action: "allow" },
    ];
    const merged = mergePermissions(ruleset1, ruleset2, ruleset3);
    expect(merged).toEqual([
      { pattern: "*", action: "allow" },
      { pattern: "git-*", action: "allow" },
    ]);
  });
});

describe("evaluateSkillPermission", () => {
  test("exact pattern match returns correct action", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "deny" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("deny");
  });

  test("wildcard match when no exact match", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "git-*", action: "allow" },
        { pattern: "*", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("pdf", permissions)).toBe("deny");
  });

  test("first matching rule wins in config order (two unrelated names)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "A", action: "allow" },
        { pattern: "B", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("A", permissions)).toBe("allow");
    expect(evaluateSkillPermission("B", permissions)).toBe("deny");
  });

  test("reversed order — first rule still wins (no specificity overrides)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "B", action: "deny" },
        { pattern: "A", action: "allow" },
      ],
    };
    expect(evaluateSkillPermission("A", permissions)).toBe("allow");
    expect(evaluateSkillPermission("B", permissions)).toBe("deny");
  });

  test("wildcard earlier than specific — wildcard wins (config-order)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "*", action: "deny" },
        { pattern: "git-helper", action: "allow" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("deny");
  });

  test("specific earlier than wildcard — specific wins (config-order)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "git-helper", action: "allow" },
        { pattern: "*", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("allow");
  });

  test("deny action", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "deny" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("deny");
  });

  test("ask action", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "ask" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("ask");
  });

  test("allow action (explicit)", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "allow" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("allow");
  });

  test("empty permissions defaults to allow", () => {
    const permissions: AgentPermissions = {
      skill: [],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("allow");
  });

  test("no matching pattern defaults to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-*", action: "deny" }],
    };
    expect(evaluateSkillPermission("pdf", permissions)).toBe("allow");
  });

  test("config order wins over pattern length (longer specific listed first)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "git-helper", action: "allow" },
        { pattern: "git-*", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("allow");
  });

  test("config order wins over pattern length (shorter prefix listed first)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "git-*", action: "deny" },
        { pattern: "git-helper", action: "allow" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("deny");
  });

  test("case insensitive pattern matching", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "Git-Helper", action: "deny" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("deny");
  });

  test("tag capability match returns deny", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:capability:web", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, { capability: "web" })).toBe("deny");
  });

  test("tag capability mismatch defaults to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:capability:web", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, { capability: "db" })).toBe("allow");
  });

  test("tag audience match returns deny", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:audience:reviewer", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, { audience: "reviewer" })).toBe("deny");
  });

  test("tag audience mismatch defaults to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:audience:reviewer", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, { audience: "implementer" })).toBe("allow");
  });

  test("tag maturity match returns ask", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:maturity:experimental", action: "ask" }],
    };
    expect(evaluateSkillPermission("any", permissions, { maturity: "experimental" })).toBe("ask");
  });

  test("tag maturity mismatch defaults to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:maturity:experimental", action: "ask" }],
    };
    expect(evaluateSkillPermission("any", permissions, { maturity: "stable" })).toBe("allow");
  });

  test("unrecognised tag kind falls through to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:priority:high", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, { capability: "web" })).toBe("allow");
  });

  test("tag rule without metadata falls through to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:capability:web", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, undefined)).toBe("allow");
  });

  test("tag rule with empty metadata falls through to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:capability:web", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, {})).toBe("allow");
  });

  test("wildcard before tag pattern — wildcard wins (config-order, tag rule never consulted)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "*", action: "allow" },
        { pattern: "tag:capability:web", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("any", permissions, { capability: "web" })).toBe("allow");
  });

  test("tag pattern before wildcard — tag wins (config-order)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "tag:capability:web", action: "deny" },
        { pattern: "*", action: "allow" },
      ],
    };
    expect(evaluateSkillPermission("any", permissions, { capability: "web" })).toBe("deny");
  });

  test("name pattern before tag pattern — name wins (config-order)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "git-*", action: "allow" },
        { pattern: "tag:capability:git", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions, { capability: "git" })).toBe("allow");
  });

  test("tag pattern before name pattern — tag wins (config-order)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "tag:capability:git", action: "deny" },
        { pattern: "git-*", action: "allow" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions, { capability: "git" })).toBe("deny");
  });

  test("exact-name match still works with undefined metadata", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "deny" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions, undefined)).toBe("deny");
  });

  test("prefix wildcard match still works with undefined metadata", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-*", action: "deny" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions, undefined)).toBe("deny");
  });

  test("empty permissions with wildcard skill name defaults to allow", () => {
    const permissions: AgentPermissions = { skill: [] };
    expect(evaluateSkillPermission("*", permissions)).toBe("allow");
  });

  // --- Defaults from tag-schema.md:100 (metadata-less skills) ---

  test("metadata-less defaults audience to 'all' (tag:audience:all matches)", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:audience:all", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, undefined)).toBe("deny");
  });

  test("metadata-less defaults maturity to 'stable' (tag:maturity:stable matches)", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:maturity:stable", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, undefined)).toBe("deny");
  });

  test("metadata-less does NOT default capability — tag:capability rule falls through to allow", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:capability:web", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, undefined)).toBe("allow");
  });

  test("metadata without audience field defaults audience to 'all'", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:audience:all", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, { maturity: "stable" })).toBe("deny");
  });

  test("empty metadata object defaults audience to 'all'", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:audience:all", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, {})).toBe("deny");
  });

  test("empty metadata object defaults maturity to 'stable'", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:maturity:stable", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, {})).toBe("deny");
  });

  // --- Lenient matcher for unrecognised tag kinds ---

  test("unrecognised tag kind falls through to allow (no metadata)", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:priority:high", action: "deny" }],
    };
    expect(evaluateSkillPermission("any", permissions, undefined)).toBe("allow");
  });

  // --- Config-order tie-break and edge cases ---

  test("config-order tie-break — each named rule resolves correctly", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "alpha", action: "allow" },
        { pattern: "beta", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("alpha", permissions)).toBe("allow");
    expect(evaluateSkillPermission("beta", permissions)).toBe("deny");
  });

  test("tag rule before name rule — tag wins when both could match", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "tag:capability:git", action: "allow" },
        { pattern: "git-helper", action: "deny" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions, { capability: "git" })).toBe("allow");
  });

  test("first-match-wins via unrelated rule — wildcard never reached", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "foo", action: "allow" },
        { pattern: "bar", action: "deny" },
        { pattern: "*", action: "ask" },
      ],
    };
    expect(evaluateSkillPermission("bar", permissions)).toBe("deny");
  });
});

describe("isSkillAllowed", () => {
  test("allowed skill returns true", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "allow" }],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(true);
  });

  test("denied skill returns false", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "deny" }],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(false);
  });

  test("ask skill returns true (ask is not deny)", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-helper", action: "ask" }],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(true);
  });

  test("no matching rule defaults to allowed", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "git-*", action: "deny" }],
    };
    expect(isSkillAllowed("pdf", permissions)).toBe(true);
  });

  test("empty permissions defaults to allowed", () => {
    const permissions: AgentPermissions = {
      skill: [],
    };
    expect(isSkillAllowed("anything", permissions)).toBe(true);
  });

  test("wildcard deny returns false", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "*", action: "deny" }],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(false);
  });

  test("wildcard allow returns true", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "*", action: "allow" }],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(true);
  });

  test("wildcard deny before specific allow — wildcard wins (config-order)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "*", action: "deny" },
        { pattern: "git-helper", action: "allow" },
      ],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(false);
  });

  test("specific allow before wildcard deny — specific wins (config-order)", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "git-helper", action: "allow" },
        { pattern: "*", action: "deny" },
      ],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(true);
  });

  test("tag deny with matching metadata returns false", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:capability:web", action: "deny" }],
    };
    expect(isSkillAllowed("any", permissions, { capability: "web" })).toBe(false);
  });

  test("tag ask with matching metadata returns true", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:maturity:experimental", action: "ask" }],
    };
    expect(isSkillAllowed("any", permissions, { maturity: "experimental" })).toBe(true);
  });

  test("tag without matching metadata falls through to allowed", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "tag:capability:web", action: "deny" }],
    };
    expect(isSkillAllowed("any", permissions, {})).toBe(true);
  });
});
