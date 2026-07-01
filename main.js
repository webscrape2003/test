import { Actor } from 'apify';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';

// Wrap your existing function for Apify
async function scrapePage(url, options = {}) {
    let { headless = true, timeout = 60000, waitForSelector = "span.text-xl", selectors = {} } = options;

    if (!process.env.DISPLAY && headless === false) {
        headless = true;
    }

    const titleSelector = selectors.title || "span.text-xl";
    const detailsSelector = selectors.details || "span.text-gray-500";
    const scriptContains = selectors.scriptContains || "function download()";

    const browser = await chromium.launch({
        headless,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            ...(headless ? ["--disable-gpu"] : []),
        ],
    });

    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.goto(url, { waitUntil: "networkidle", timeout });
    await page.waitForSelector(waitForSelector, { timeout });

    const html = await page.content();
    const cookies = await context.cookies();

    await browser.close();

    const $ = cheerio.load(html);
    const title = $(titleSelector).first().text().trim();
    const detailsText = $(detailsSelector).first().text().trim();
    const size = detailsText.match(/Size:\s*([\d.]+(?:MB|GB|KB))/i)?.[1] || "N/A";
    const downloads = detailsText.match(/Downloads:\s*(\d+)/i)?.[1] || "N/A";

    let directUrl = null;
    $("script").each((i, el) => {
        const code = $(el).html();
        if (code && code.includes(scriptContains)) {
            const match = code.match(/window\.open\("([^"]+)"\)/);
            if (match) directUrl = match[1];
            return false;
        }
    });

    return { html, title, size, downloads, directUrl, cookies };
}

// Apify Actor entry point
await Actor.init();

// Get input from API call
const input = await Actor.getInput();
const urlToScrape = input.url;  // <-- This is where the API URL comes in!

if (!urlToScrape) {
    console.error('Error: No URL provided in input');
    process.exit(1);
}

console.log(`Scraping URL: ${urlToScrape}`);

try {
    // Call your existing function
    const result = await scrapePage(urlToScrape, {
        headless: true,
        timeout: input.timeout || 60000,
        waitForSelector: input.waitForSelector || "span.text-xl",
        selectors: {
            title: input.titleSelector || "span.text-xl",
            details: input.detailsSelector || "span.text-gray-500",
        }
    });

    // Push results to Apify dataset (API will return this)
    await Actor.pushData({
        scrapedAt: new Date().toISOString(),
        url: urlToScrape,
        result: result
    });

    console.log('Scraping completed successfully!');

} catch (error) {
    console.error('Scraping failed:', error);
    await Actor.pushData({
        url: urlToScrape,
        error: error.message,
        timestamp: new Date().toISOString()
    });
}

await Actor.exit();
