import { describe, expect, it } from "vitest";
import { __testing } from "./x402-payment.js";

describe("x402 permit cache key", () => {
  it("includes the account address", () => {
    const key = __testing.buildPermitCacheKey({
      network: "eip155:8453",
      asset: "0xasset",
      payTo: "0xpayto",
      cap: "1000000",
      account: "0xaccount",
    });

    expect(key).toContain("0xaccount");
  });

  it("differs for different accounts", () => {
    const base = {
      network: "eip155:8453",
      asset: "0xasset",
      payTo: "0xpayto",
      cap: "1000000",
    };

    const keyA = __testing.buildPermitCacheKey({ ...base, account: "0xaccountA" });
    const keyB = __testing.buildPermitCacheKey({ ...base, account: "0xaccountB" });

    expect(keyA).not.toEqual(keyB);
  });
});

describe("parseSawConfig", () => {
  it("parses a valid SAW sentinel", () => {
    const result = __testing.parseSawConfig("saw:main@/run/saw.sock");
    expect(result).toEqual({ walletName: "main", socketPath: "/run/saw.sock" });
  });

  it("parses a sentinel with a custom wallet and socket", () => {
    const result = __testing.parseSawConfig("saw:spending@/tmp/agent-wallet.sock");
    expect(result).toEqual({ walletName: "spending", socketPath: "/tmp/agent-wallet.sock" });
  });

  it("returns null for a private key", () => {
    const result = __testing.parseSawConfig(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    );
    expect(result).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(__testing.parseSawConfig(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(__testing.parseSawConfig("")).toBeNull();
  });

  it("returns null for missing @ separator", () => {
    expect(__testing.parseSawConfig("saw:main")).toBeNull();
  });

  it("returns null for missing wallet name", () => {
    expect(__testing.parseSawConfig("saw:@/run/saw.sock")).toBeNull();
  });

  it("trims whitespace", () => {
    const result = __testing.parseSawConfig("  saw:main@/run/saw.sock  ");
    expect(result).toEqual({ walletName: "main", socketPath: "/run/saw.sock" });
  });
});

describe("parseAwalConfig", () => {
  it("parses a valid awal sentinel", () => {
    const result = __testing.parseAwalConfig("awal:user@example.com");
    expect(result).toEqual({ email: "user@example.com" });
  });

  it("parses an email with plus addressing", () => {
    const result = __testing.parseAwalConfig("awal:user+agent@example.com");
    expect(result).toEqual({ email: "user+agent@example.com" });
  });

  it("returns null for a SAW sentinel", () => {
    expect(__testing.parseAwalConfig("saw:main@/run/saw.sock")).toBeNull();
  });

  it("returns null for a private key", () => {
    expect(
      __testing.parseAwalConfig(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      ),
    ).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(__testing.parseAwalConfig(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(__testing.parseAwalConfig("")).toBeNull();
  });

  it("returns null for awal: without email", () => {
    expect(__testing.parseAwalConfig("awal:")).toBeNull();
  });

  it("trims whitespace", () => {
    const result = __testing.parseAwalConfig("  awal:user@example.com  ");
    expect(result).toEqual({ email: "user@example.com" });
  });
});
