// worker/src/booking/dashboard-tidy.test.ts
import { describe, it, expect } from "vitest";
import { planEnquiryTidy, planBookingTidy, buildTidyPlan, type TidyEnquiry, type TidyBooking } from "./dashboard-tidy";

const NOW = new Date("2026-08-01T00:00:00Z").getTime();
const old = "2026-01-01T00:00:00Z"; // >120d before NOW
const recent = "2026-07-20T00:00:00Z";

describe("planEnquiryTidy", () => {
  it("archives resolved + old enquiries", () => {
    const rows: TidyEnquiry[] = [
      { id: "1", status: "converted", created_at: old, deleted_at: null },
      { id: "2", status: "closed", created_at: old, deleted_at: null },
      { id: "3", status: "new", created_at: old, deleted_at: null }, // unresolved → keep
      { id: "4", status: "converted", created_at: recent, deleted_at: null }, // too new → keep
    ];
    const { archive, flag } = planEnquiryTidy(rows, { now: NOW });
    expect(archive.sort()).toEqual(["1", "2"]);
    expect(flag).toEqual([]);
  });
  it("flags captcha-failed unresolved old enquiries", () => {
    const rows: TidyEnquiry[] = [
      { id: "9", status: "new", created_at: old, deleted_at: null, flagged_review: true },
    ];
    const { flag } = planEnquiryTidy(rows, { now: NOW });
    expect(flag).toEqual(["9"]);
  });
  it("skips already deleted", () => {
    const rows: TidyEnquiry[] = [{ id: "1", status: "converted", created_at: old, deleted_at: "2026-02-01T00:00:00Z" }];
    expect(planEnquiryTidy(rows, { now: NOW }).archive).toEqual([]);
  });
});

describe("planBookingTidy", () => {
  it("archives settled bookings past cutoff", () => {
    const rows: TidyBooking[] = [
      { id: "b1", status: "settled", wedding_date: old, archived_at: null, deleted_at: null },
      { id: "b2", status: "settled", wedding_date: recent, archived_at: null, deleted_at: null }, // too new
      { id: "b3", status: "settled", wedding_date: old, archived_at: "2026-03-01T00:00:00Z", deleted_at: null }, // already archived
    ];
    expect(planBookingTidy(rows, { now: NOW })).toEqual(["b1"]);
  });
});

describe("buildTidyPlan", () => {
  it("summarises archive + flag counts", () => {
    const enquiries: TidyEnquiry[] = [
      { id: "1", status: "converted", created_at: old, deleted_at: null },
      { id: "9", status: "new", created_at: old, deleted_at: null, flagged_review: true },
    ];
    const bookings: TidyBooking[] = [{ id: "b1", status: "settled", wedding_date: old, archived_at: null, deleted_at: null }];
    const plan = buildTidyPlan(enquiries, bookings, { now: NOW });
    expect(plan.archive_enquiry_ids).toEqual(["1"]);
    expect(plan.archive_booking_ids).toEqual(["b1"]);
    expect(plan.flag_ids).toEqual(["9"]);
    expect(plan.summary).toContain("1 enquiry(s) + 1 booking(s) archived");
    expect(plan.summary).toContain("1 flagged for review");
  });
});
