/** @format */

import puppeteer from "puppeteer";
import fs from "fs";

(async () => {
  try {
    // Launch the browser
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      slowMo: 50,
    });

    // Open a new page
    const page = await browser.newPage();

    // Navigate to the arXiv search page
    await page.goto(
      "https://arxiv.org/search/?query=Joint+Embedding+Predictive+Architecture&searchtype=all&abstracts=show&order=-submitted_date",
      { waitUntil: "networkidle2" }
    );

    // Get today's and yesterday's date in the format "Submitted 20 February, 2025"
    const formatDate = (date) =>
      `Submitted ${date.getDate()} ${date.toLocaleString("en-US", {
        month: "long",
      })}, ${date.getFullYear()}`;

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const todayFormatted = formatDate(today);
    const yesterdayFormatted = formatDate(yesterday);

    console.log(todayFormatted, yesterdayFormatted);

    // Extract titles, links, and submission dates of papers
    const papers = await page.evaluate(
      (todayFormatted, yesterdayFormatted) => {
        return (
          Array.from(document.querySelectorAll("li.arxiv-result"))
            .map((item) => {
              const submittedDateElement = item.querySelector("p.is-size-7");
              const submittedDate = submittedDateElement
                ? submittedDateElement.textContent.trim()
                : "N/A";

              return {
                title:
                  item.querySelector(".title")?.textContent.trim() || "N/A",
                link: item.querySelector(".list-title a")?.href || "N/A",
                submittedDate,
              };
            })
            // .filter(
            //   (paper) =>
            //     paper.submittedDate.includes(todayFormatted) ||
            //     paper.submittedDate.includes(yesterdayFormatted)
            // ) // Match today's or yesterday's date
            .map(({ title, link }) => ({
              title,
              link,
            }))
        ); // Remove submittedDate from final output
      },
      todayFormatted,
      yesterdayFormatted
    );

    // Log the extracted papers as a JSON object
    console.log(JSON.stringify(papers, null, 2));

    // Write papers JSON object to a file
    fs.writeFileSync("papers.json", JSON.stringify(papers, null, 2), "utf8");
    console.log("Papers JSON file updated successfully.");

    // Close the browser
    await browser.close();
  } catch (error) {
    console.error("Error:", error);
  }
})();
