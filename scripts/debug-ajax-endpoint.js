#!/usr/bin/env node

/**
 * Debug script to test the StatBroadcast AJAX endpoint
 * Tests parts 2a, 2b, and 2c of the game ID discovery process
 */

const axios = require('axios');
const qs = require("qs");

async function fetchRawAjax(gid, time, hash) {
  const url = `https://www.statbroadcast.com/scripts/_archive.php?time=${time}&hash=${hash}`;

  // These fields must match the exact cURL request you copied
  const body = {
    draw: 1,
    start: 0,
    length: 100,
    gid: gid,
    sports: "M;bbgame",
    search: { value: "", regex: false },
    "order[0][column]": 0,
    "order[0][dir]": "desc"
  };

  const response = await axios.post(url, qs.stringify(body), {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, text/javascript, */*;q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `https://www.statbroadcast.com/events/archive.php?gid=${gid}`
    }
  });

  return response.data;
}

async function testAjaxEndpoint(gid) {
  console.log('\n' + '='.repeat(70));
  console.log(`TESTING AJAX ENDPOINT FOR: ${gid}`);
  console.log('='.repeat(70));
 const puppeteer = require("puppeteer");

async function getLiveHash(gid) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  let captured;

  page.on("request", (req) => {
    if (req.url().includes("_archive.php")) {
      const url = new URL(req.url());
      captured = {
        time: url.searchParams.get("time"),
        hash: url.searchParams.get("hash"),
        body: req.postData()
      };
    }
  });

  await page.goto(`https://www.statbroadcast.com/events/archive.php?gid=${gid}`, {
    waitUntil: "networkidle2"
  });

  await browser.close();
  return captured;
}

}
