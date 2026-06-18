/* LUSTIQUE CO. — shared behavior (no markup injection).
   Header/footer are baked into each page by build.mjs. */
document.documentElement.classList.add("js"); // gate JS-only enhancements (photo blur-up) so content always shows without/with-stale JS
document.addEventListener("DOMContentLoaded", () => {
  // sticky nav shadow
  const nav = document.getElementById("nav");
  if (nav) addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 20), { passive: true });

  // mobile menu
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.setAttribute("aria-controls", "navLinks");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // scroll reveals
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));

  // Cookie consent (POPIA) — GA4 is NOT loaded until explicit Accept.
  // GA4 placeholder: replace window.LUSTIQUE_GA_ID (injected by BaseLayout) with real Measurement ID at deploy.
  const banner = document.getElementById("cookieBanner");
  if (banner) {
    const loadGA4 = () => {
      const gaId = window.LUSTIQUE_GA_ID;
      if (!gaId || gaId === "G-XXXXXXXXXX") return; // placeholder — skip until real ID is set
      const s = document.createElement("script");
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + gaId;
      s.async = true;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function() { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("consent", "default", { analytics_storage: "denied" });
      window.gtag("config", gaId);
      window.gtag("consent", "update", { analytics_storage: "granted" });
    };
    let consent = null;
    try { consent = localStorage.getItem("lc_cookie"); } catch (e) {}
    if (!consent) {
      banner.hidden = false;
    } else if (consent === "accepted") {
      loadGA4();
    }
    const decide = (val) => {
      try { localStorage.setItem("lc_cookie", val); } catch (e) {}
      banner.hidden = true;
      if (val === "accepted") loadGA4();
    };
    const a = document.getElementById("cookieAccept");
    const d = document.getElementById("cookieDecline");
    if (a) a.addEventListener("click", () => decide("accepted"));
    if (d) d.addEventListener("click", () => decide("declined"));
    // "Manage cookies" link: clears consent and re-opens the banner
    document.addEventListener("click", (e) => {
      if (e.target && e.target.id === "manageCookies") {
        e.preventDefault();
        try { localStorage.removeItem("lc_cookie"); } catch (_e) {}
        banner.hidden = false;
      }
    });
  }

  // back to top
  const toTop = document.getElementById("toTop");
  if (toTop) {
    addEventListener("scroll", () => toTop.classList.toggle("show", scrollY > 500), { passive: true });
    toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
  }

  // portfolio filters — category + artist, combined, with a graceful empty state
  const catRow = document.getElementById("galleryFilters");
  const artRow = document.getElementById("artistFilters");
  if (catRow || artRow) {
    let activeCat = "all", activeArtist = "all";
    const empty = document.getElementById("galleryEmpty");
    const emptyName = empty && empty.querySelector("[data-empty-name]");
    const apply = () => {
      let shown = 0;
      document.querySelectorAll(".gitem").forEach(it => {
        const okCat = activeCat === "all" || it.dataset.cat === activeCat;
        const okArt = activeArtist === "all" || it.dataset.artist === activeArtist;
        const show = okCat && okArt;
        it.classList.toggle("hide", !show);
        if (show) shown++;
      });
      // no matches (e.g. an artist whose photos aren't up yet) → show the panel
      if (empty) {
        if (shown === 0) {
          const active = artRow && artRow.querySelector("button.active");
          if (emptyName && active) emptyName.textContent = active.textContent.trim();
          empty.hidden = false;
        } else {
          empty.hidden = true;
        }
      }
    };
    const wire = (row, set) => {
      if (!row) return;
      row.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.classList.contains("active") ? "true" : "false"));
      row.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        row.querySelectorAll("button").forEach(x => { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
        set(b.dataset.filter);
        apply();
      });
    };
    wire(catRow, (val) => (activeCat = val));
    wire(artRow, (val) => (activeArtist = val));
    // "View all work" in the empty panel resets to All (reuses the click handler)
    if (empty && artRow) {
      const reset = empty.querySelector("[data-reset]");
      if (reset) reset.addEventListener("click", () => {
        const all = artRow.querySelector('button[data-filter="all"]');
        if (all) all.click();
      });
    }
  }

  // FAQ accordion — ARIA wired on init so screen readers see the relationship from the start
  document.querySelectorAll(".faq-q").forEach((q, i) => {
    const item = q.closest(".faq-item");
    const ans = item.querySelector(".faq-a");
    const id = "faq-ans-" + i;
    ans.id = id;
    q.setAttribute("aria-expanded", "false");
    q.setAttribute("aria-controls", id);
    q.addEventListener("click", () => {
      const open = item.classList.toggle("open");
      q.setAttribute("aria-expanded", open ? "true" : "false");
      ans.style.maxHeight = open ? ans.scrollHeight + "px" : "";
    });
  });

  // testimonial slideshow (auto-loop + dots)
  const slider = document.querySelector(".testi-slider");
  if (slider) {
    const slides = Array.from(slider.querySelectorAll(".testi-slide"));
    const dotsWrap = document.querySelector(".testi-dots");
    if (slides.length > 1) {
      let i = 0;
      slides.forEach((_, n) => {
        const b = document.createElement("button");
        b.setAttribute("aria-label", "Review " + (n + 1));
        if (n === 0) b.classList.add("active");
        b.addEventListener("click", () => { go(n); reset(); });
        if (dotsWrap) dotsWrap.appendChild(b);
      });
      const dots = dotsWrap ? Array.from(dotsWrap.children) : [];
      const go = (n) => {
        slides[i].classList.remove("active");
        if (dots[i]) dots[i].classList.remove("active");
        i = (n + slides.length) % slides.length;
        slides[i].classList.add("active");
        if (dots[i]) dots[i].classList.add("active");
      };
      let timer = setInterval(() => go(i + 1), 6000);
      const reset = () => { clearInterval(timer); timer = setInterval(() => go(i + 1), 6000); };
    }
  }

  // photo blur-up — fade/sharpen each real <img.ph-img> once it loads (handles cached images)
  document.querySelectorAll("img.ph-img").forEach((img) => {
    const ph = img.closest(".ph");
    if (!ph) return;
    if (img.complete && img.naturalWidth > 0) { ph.classList.add("loaded"); return; }
    img.addEventListener("load", () => ph.classList.add("loaded"), { once: true });
    img.addEventListener("error", () => ph.classList.add("img-error"), { once: true });
  });
});
