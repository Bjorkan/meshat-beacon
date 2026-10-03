import { describe, it, expect } from "vitest";
import { nodeSearchParams } from "../../../src/features/nodes/node-search";

describe("nodeSearchParams", () => {
  it("maps the name field to the name param", () => {
    expect(nodeSearchParams("name", "alpha")).toEqual({ name: "alpha" });
  });

  it("maps the pubkey field to a lowercased hex prefix", () => {
    expect(nodeSearchParams("pubkey", "AB12")).toEqual({ pubkeyPrefix: "ab12" });
  });

  it("drops a non-hex pubkey prefix instead of firing a request the server 400s", () => {
    // names/spaces are non-hex; sending them as pubkeyPrefix would 400 the whole table
    expect(nodeSearchParams("pubkey", "alice")).toEqual({ pubkeyPrefix: undefined });
    expect(nodeSearchParams("pubkey", "de ad")).toEqual({ pubkeyPrefix: undefined });
  });

  it("treats blank input as no filter on either field", () => {
    expect(nodeSearchParams("name", "  ")).toEqual({ name: undefined });
    expect(nodeSearchParams("pubkey", "")).toEqual({ pubkeyPrefix: undefined });
  });
});
