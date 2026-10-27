import { describe, it, expect } from "vitest";
import { isBounceNotice, findBouncedAddresses } from "./bounce";

describe("isBounceNotice", () => {
  it("catches typical undeliverable subjects", () => {
    expect(isBounceNotice({ subject: "Undeliverable: Following up", fromAddress: "postmaster@x.com" })).toBe(true);
    expect(isBounceNotice({ subject: "Mail Delivery Subsystem", fromAddress: "mailer-daemon@googlemail.com" })).toBe(true);
    expect(isBounceNotice({ subject: "Delivery Status Notification (Failure)", fromAddress: "mailer-daemon@googlemail.com" })).toBe(true);
  });
  it("catches a delivery-status report by header", () => {
    expect(isBounceNotice({ subject: "Hi", fromAddress: "a@b.com", headers: [{ name: "Content-Type", value: "multipart/report; report-type=delivery-status" }] })).toBe(true);
  });
  it("ignores delays, out-of-office and ordinary mail", () => {
    expect(isBounceNotice({ subject: "Delivery Status Notification (Delay)", fromAddress: "mailer-daemon@googlemail.com" })).toBe(false);
    expect(isBounceNotice({ subject: "Automatic reply: away", fromAddress: "owner@bar.com" })).toBe(false);
    expect(isBounceNotice({ subject: "Re: Live music", fromAddress: "owner@bar.com" })).toBe(false);
  });
});

describe("findBouncedAddresses", () => {
  const known = ["booking@bar.com", "info@club.com"];
  it("finds known addresses in the text", () => {
    expect(findBouncedAddresses("Your message to Booking@Bar.com couldn't be delivered.", known)).toEqual(["booking@bar.com"]);
  });
  it("ignores addresses that aren't in the pipeline", () => {
    expect(findBouncedAddresses("Your message to other@place.com failed", known)).toEqual([]);
  });
  it("handles trailing punctuation and repeats", () => {
    expect(findBouncedAddresses("to info@club.com. Also info@club.com,", known)).toEqual(["info@club.com"]);
  });
});
