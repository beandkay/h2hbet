const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Navigate to the schedule page
  await page.goto('https://h2hggl.com/en/esoccer/schedule', { waitUntil: 'networkidle2' });
  
  // Wait a bit to ensure dynamic content loads
  await new Promise(r => setTimeout(r, 5000));
  
  // Extract text content from the body to see what we got
  const text = await page.evaluate(() => document.body.innerText);
  console.log("--- START OF TEXT ---");
  console.log(text.substring(0, 5000)); // Print first 5000 chars of text
  console.log("--- END OF TEXT ---");
  
  // Try to find anything with 'match' or 'player' or 'schedule' in classes/data
  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .filter(el => {
         const cl = el.className;
         return typeof cl === 'string' && (cl.includes('match') || cl.includes('player') || cl.includes('participant') || cl.includes('game') || cl.includes('score'));
      })
      .map(el => el.innerText.trim())
      .filter(text => text.length > 0 && text.length < 200)
      .slice(0, 50); // Get top 50 matches
  });
  
  console.log("--- ELEMENTS ---");
  console.log(JSON.stringify(elements, null, 2));
  
  await browser.close();
})();
