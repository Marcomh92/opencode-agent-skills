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

  test("specific pattern takes precedence over wildcard", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "*", action: "deny" },
        { pattern: "git-helper", action: "allow" },
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

  test("longer specific pattern takes precedence over shorter specific pattern", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "git-*", action: "deny" },
        { pattern: "git-helper", action: "allow" },
      ],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("allow");
  });

  test("case insensitive pattern matching", () => {
    const permissions: AgentPermissions = {
      skill: [{ pattern: "Git-Helper", action: "deny" }],
    };
    expect(evaluateSkillPermission("git-helper", permissions)).toBe("deny");
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

  test("specific allow overrides wildcard deny", () => {
    const permissions: AgentPermissions = {
      skill: [
        { pattern: "*", action: "deny" },
        { pattern: "git-helper", action: "allow" },
      ],
    };
    expect(isSkillAllowed("git-helper", permissions)).toBe(true);
  });
});
