import { describe, test, expect } from "bun:test";
import { levenshtein, findClosestMatch, parseJsonc } from "./utils";

describe("levenshtein", () => {
  test("identical strings have distance 0", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  test("completely different strings have high distance", () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  test("single character difference", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  test("insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  test("deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  test("substitution", () => {
    expect(levenshtein("cat", "cut")).toBe(1);
  });

  test("case sensitive", () => {
    expect(levenshtein("Cat", "cat")).toBe(1);
  });
});

describe("findClosestMatch", () => {
  test("returns null for empty candidate list", () => {
    expect(findClosestMatch("test", [])).toBe(null);
  });

  test("exact match returns the match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf");
  });

  test("prefix match - user types partial skill name", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("prefix match - longer match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("brainstorming");
  });

  test("typo correction via Levenshtein", () => {
    const candidates = ["pattern", "git-helper", "pdf"];
    expect(findClosestMatch("patern", candidates)).toBe("pattern");
  });

  test("case insensitive matching", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("Brainstorming");
  });

  test("case insensitive exact match", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("PDF", candidates)).toBe("PDF");
  });

  test("substring match", () => {
    const candidates = ["document-processor", "git-helper", "pdf-reader"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("no close matches below threshold returns null", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("xyzabc", candidates)).toBe(null);
  });

  test("multiple similar candidates returns best match", () => {
    const candidates = ["test", "testing", "tests"];
    expect(findClosestMatch("test", candidates)).toBe("test");
  });

  test("prefix matching beats substring matching", () => {
    const candidates = ["pdf-reader", "reader-pdf"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("handles hyphenated names", () => {
    const candidates = ["git-helper", "github-actions", "gitlab-ci"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("script path matching", () => {
    const candidates = ["build.sh", "scripts/deploy.sh", "tools/build.sh"];
    expect(findClosestMatch("deploy", candidates)).toBe("scripts/deploy.sh");
  });

  test("typo in script name", () => {
    const candidates = ["build.sh", "deploy.sh", "test.sh"];
    expect(findClosestMatch("biuld.sh", candidates)).toBe("build.sh");
  });
});

describe("parseJsonc", () => {
  test("parses a comment-free document identically to JSON.parse", () => {
    const text = `{
      "name": "demo",
      "nested": { "list": [1, 2, 3], "flag": true, "nil": null }
    }`;
    expect(parseJsonc(text)).toEqual(JSON.parse(text));
  });

  test("strips // line comments", () => {
    const text = `{
      // leading comment
      "a": 1, // trailing comment
      "b": 2
      // comment before the closing brace
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: 2 });
  });

  test("strips /* */ block comments, including multi-line ones", () => {
    const text = `{
      /* single line */
      "a": 1, /* inline */ "b": 2,
      /* multi
         line
         comment */
      "c": 3
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: 2, c: 3 });
  });

  test("strips a // comment that runs to the end of the input", () => {
    expect(parseJsonc('{"a": 1} // no trailing newline')).toEqual({ a: 1 });
  });

  test("does not strip comment-like sequences inside string values", () => {
    const text =
      '{"url": "https://example.com/a//b", "template": "/* not a comment */", "code": "x // y /* z */"}';
    expect(parseJsonc(text)).toEqual({
      url: "https://example.com/a//b",
      template: "/* not a comment */",
      code: "x // y /* z */",
    });
  });

  test("does not strip comment markers inside object keys", () => {
    expect(parseJsonc('{"a//b": 1, "c/*d": 2}')).toEqual({ "a//b": 1, "c/*d": 2 });
  });

  test("preserves escaped quotes, including a // immediately after them", () => {
    const text = String.raw`{ "quote": "he said \"// hi\"" }`;
    expect(parseJsonc(text)).toEqual({ quote: 'he said "// hi"' });
  });

  test("preserves escaped backslashes inside strings", () => {
    const text = String.raw`{ "path": "C:\\temp\\", "next": "// ok" }`;
    expect(parseJsonc(text)).toEqual({ path: "C:\\temp\\", next: "// ok" });
  });

  test("does not treat a quote inside a comment as starting a string", () => {
    const text = `{
      // don't let this "quote break parsing
      "a": 1
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1 });
  });

  test("does not treat a lone slash as a comment", () => {
    expect(parseJsonc('{"ratio": "1/2"}')).toEqual({ ratio: "1/2" });
  });

  test("throws on genuinely invalid JSON", () => {
    expect(() => parseJsonc("{not json")).toThrow();
    expect(() => parseJsonc('{"a": 1')).toThrow();
  });

  test("throws on an unterminated block comment, while normal commented docs still parse", () => {
    expect(() => parseJsonc('{"a": 1} /* typo')).toThrow("Unterminated block comment");
    // Regression guard: the unterminated-comment check must not reject
    // well-formed commented documents.
    expect(parseJsonc('{"a": 1 /* inline */}')).toEqual({ a: 1 });
  });
});
