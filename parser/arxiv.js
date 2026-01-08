/** @format */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const URL =
  "https://arxiv.org/search/?query=Joint+Embedding+Predictive+Architecture&searchtype=all&abstracts=show&order=-submitted_date";

// Centralized timeouts so they are easy to tune.
const TIMEOUTS = {
  launchMs: 60_000,
  navMs: 60_000,
  selectorMs: 30_000,
  evalMs: 30_000,
};

// Retry policy (bounded).
const RETRY = {
  attempts: 3,
  baseDelayMs: 2_000,
};

const OUT_FILE = "papers.json";
const DIAG_DIR = "diagnostics";

// Small helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowStamp = () =>
  new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

async function withRetries(fn, { attempts, baseDelayMs }, label = "operation") {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const delay = baseDelayMs * Math.pow(2, i - 1);
      console.error(
        `[${label}] attempt ${i}/${attempts} failed: ${err?.message || err}`
      );
      if (i < attempts) {
        console.error(`[${label}] retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

async function writeDiagnostics(page, reason) {
  try {
    fs.mkdirSync(DIAG_DIR, { recursive: true });
    const stamp = nowStamp();
    const shotPath = path.join(DIAG_DIR, `arxiv_fail_${stamp}.png`);
    const htmlPath = path.join(DIAG_DIR, `arxiv_fail_${stamp}.html`);

    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => "");
    fs.writeFileSync(
      htmlPath,
      `<!-- reason: ${String(reason)} -->\n` + html,
      "utf8"
    );

    console.error(`Diagnostics saved: ${shotPath}`);
    console.error(`Diagnostics saved: ${htmlPath}`);
  } catch (e) {
    console.error(`Failed to write diagnostics: ${e?.message || e}`);
  }
}

function formatDate(date) {
  return `Submitted ${date.getDate()} ${date.toLocaleString("en-US", {
    month: "long",
  })}, ${date.getFullYear()}`;
}

(async () => {
  let browser;

  // Force an overall watchdog so the process cannot run forever.
  // If you run in CI, you can tune this down.
  const HARD_KILL_MS = 5 * 60_000; // 5 minutes
  const watchdog = setTimeout(() => {
    console.error(
      `Hard watchdog triggered after ${HARD_KILL_MS}ms. Exiting.`
    );
    process.exit(1);
  }, HARD_KILL_MS);

  try {
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      // slowMo can make CI timing worse; consider disabling in pipelines.
      slowMo: 50,
      timeout: TIMEOUTS.launchMs,
    });

    const page = await browser.newPage();

    // Make all default waits bounded.
    page.setDefaultNavigationTimeout(TIMEOUTS.navMs);
    page.setDefaultTimeout(TIMEOUTS.selectorMs);

    // Optional: reduce chances of “idle never happens” scenarios.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      // Block heavyweight resources that are not needed to parse results.
      if (type === "font" || type === "image" || type === "media") {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on("console", (msg) => {
      // Useful when diagnosing headless failures.
      // You can silence this if it is too noisy.
      const txt = msg.text();
      if (txt) console.log(`[page] ${txt}`);
    });

    page.on("pageerror", (err) => {
      console.error(`[pageerror] ${err?.message || err}`);
    });

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const todayFormatted = formatDate(today);
    const yesterdayFormatted = formatDate(yesterday);

    console.log("Filtering dates:", todayFormatted, "OR", yesterdayFormatted);

    // Navigation with retries. Use domcontentloaded + selector wait
    // instead of networkidle2 to avoid stuck “never idle” situations.
    await withRetries(
      async () => {
        await page.goto(URL, { waitUntil: "domcontentloaded" });
        // Wait until results appear, or fail fast if page structure changes.
        await page.waitForSelector("li.arxiv-result", {
          timeout: TIMEOUTS.selectorMs,
        });
      },
      RETRY,
      "goto+waitForSelector"
    );

    const papers = await withRetries(
      async () => {
        return await page.evaluate(
          (todayFormatted, yesterdayFormatted) => {
            const results = Array.from(
              document.querySelectorAll("li.arxiv-result")
            ).map((item) => {
              const submittedDateElement = item.querySelector("p.is-size-7");
              const submittedDate = submittedDateElement
                ? submittedDateElement.textContent.trim()
                : "N/A";

              const title =
                item.querySelector(".title")?.textContent.trim() || "N/A";
              const link = item.querySelector(".list-title a")?.href || "N/A";

              return { title, link, submittedDate };
            });

            // If you want to filter by today/yesterday, do it here.
            // Note: arXiv’s date string may include additional lines, so use includes().
            // Uncomment if desired.
            // const filtered = results.filter(
            //   (p) =>
            //     p.submittedDate.includes(todayFormatted) ||
            //     p.submittedDate.includes(yesterdayFormatted)
            // );
            // return filtered.map(({ title, link }) => ({ title, link }));

            return results.map(({ title, link }) => ({ title, link }));
          },
          todayFormatted,
          yesterdayFormatted
        );
      },
      RETRY,
      "page.evaluate"
    );

    console.log(JSON.stringify(papers, null, 2));

    fs.writeFileSync(OUT_FILE, JSON.stringify(papers, null, 2), "utf8");
    console.log(`Wrote ${papers.length} items to ${OUT_FILE}`);
  } catch (error) {
    console.error("Fatal error:", error?.stack || error);

    // Best-effort diagnostics if we have a page available.
    // We do not always have a page reference here, so guard.
    try {
      const pages = browser ? await browser.pages() : [];
      const page = pages?.[0];
      if (page) await writeDiagnostics(page, error?.message || error);
    } catch (_) {
      // ignore
    }

    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error("Error closing browser:", e?.message || e);
      }
    }
  }
})();
