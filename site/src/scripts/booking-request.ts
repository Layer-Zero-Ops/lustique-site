/**
 * /quote — "Proceed to book" handler.
 * Validates the estimator form, serialises form state to sessionStorage,
 * then redirects to /book where the bride completes consent + security check.
 */
import { readInput } from "./estimator";

export const BOOKING_STORAGE_KEY = "lustiqueBooking";

const el = (id: string) => document.getElementById(id);
const val = (id: string) => {
  const e = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return e ? e.value.trim() : "";
};

function applyOccasionToBookingSection(): void {
  const occ = (document.getElementById("occasion") as HTMLSelectElement | null)?.value ?? "wedding";
  const section = el("bookingSection");
  if (section) section.style.display = occ === "wedding" ? "" : "none";
}

document.addEventListener("DOMContentLoaded", () => {
  applyOccasionToBookingSection();
  document.getElementById("occasion")?.addEventListener("change", applyOccasionToBookingSection);

  const btn = el("proceedToBook") as HTMLButtonElement | null;
  const statusEl = el("proceedStatus");
  const say = (msg: string) => { if (statusEl) statusEl.textContent = msg; };

  btn?.addEventListener("click", () => {
    const fName = val("fName");
    const lName = val("lName");
    const brideEmail = val("email");
    const weddingDate = val("weddingDate");

    if (!fName || !brideEmail) {
      say("Please fill in your name and email above before proceeding.");
      return;
    }
    if (!weddingDate) {
      say("Please add your wedding date above.");
      return;
    }

    const estimateEl = el("estimateAmount");
    const estimateText = estimateEl?.textContent ?? "";
    const match = estimateText.replace(/\s/g, "").match(/\d+/);
    const estimateTotal = match ? parseInt(match[0], 10) : 0;

    sessionStorage.setItem(BOOKING_STORAGE_KEY, JSON.stringify({
      estimateInput: readInput(),
      brideName: [fName, lName].filter(Boolean).join(" "),
      brideEmail,
      bridePhone: val("phone"),
      weddingDate,
      venue: val("venueInput"),
      town: val("townInput"),
      province: val("provinceInput"),
      estimateTotal,
    }));

    window.location.href = "book.html";
  });
});
