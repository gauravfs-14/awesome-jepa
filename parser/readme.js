/** @format */

import fs from "fs";
import path from "path";

// Paths to the files
const readmePath = path.join(process.cwd(), "readme.md");
const papersJsonPath = path.join(process.cwd(), "papers.json");

// Read the existing papers JSON file
let papers = [];
if (fs.existsSync(papersJsonPath)) {
  try {
    const papersData = fs.readFileSync(papersJsonPath, "utf8");
    papers = JSON.parse(papersData);
  } catch (error) {
    console.error("Error reading or parsing papers.json:", error);
  }
}

// Read the existing README file
let readmeContent = fs.existsSync(readmePath)
  ? fs.readFileSync(readmePath, "utf8")
  : "";

// Ensure "## Papers" section exists
if (!readmeContent.includes("## Papers")) {
  readmeContent += "\n\n## Papers\n";
}

// Extract the "Papers" section
// const papersSectionRegex = /(## Papers[\s\S]*?)(\n##|\n$)/;
const papersSectionRegex = /(## Papers(?: \(\d+\))?[\s\S]*?)(\n##|\n$)/;
const match = readmeContent.match(papersSectionRegex);
let papersSection = match ? match[1].trim() : "## Papers";

// Convert existing papers into a set to avoid duplicates
const existingPapersSet = new Set(
  (papersSection.match(/^- \[.*?\]\(.*?\)/gm) || []).map((line) => line.trim())
);

// Add new papers only if they are not already listed
papers.forEach(({ title, link }) => {
  const paperEntry = `- [${title}](${link})`;
  if (!existingPapersSet.has(paperEntry)) {
    existingPapersSet.add(paperEntry);
  }
});

const paperCount = existingPapersSet.size;
// Reconstruct the "Papers" section with no extra blank lines
papersSection =
  `## Papers (${paperCount})\n` + [...existingPapersSet].join("\n");

// Update README content
readmeContent = readmeContent
  .replace(papersSectionRegex, `${papersSection}\n\n$2`)
  .trim();

// Format timestamp as human-readable UTC
const now = new Date();
const options = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
};
const timestamp = now.toLocaleString("en-US", options).replace("UTC", "UTC");

// Update "## Last Updated" section
const lastUpdatedRegex = /(## Last Updated[\s\S]*?)(\n##|\n$)/;
if (readmeContent.includes("## Last Updated")) {
  readmeContent = readmeContent.replace(
    lastUpdatedRegex,
    `## Last Updated\n${timestamp}\n\n$2`
  );
} else {
  readmeContent += `\n\n## Last Updated\n${timestamp}`;
}

// Write the updated README content back to the file
fs.writeFileSync(readmePath, readmeContent + "\n", "utf8");

console.log("README updated successfully.");