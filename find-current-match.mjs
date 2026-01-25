import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to Betclic...');
  await page.goto('https://www.betclic.pl/pilka-nozna', { waitUntil: 'domcontentloaded' });
  
  await page.waitForTimeout(3000); // Czekamy na załadowanie
  
  // Spróbuj znaleźć linki do meczów
  const matchLinks = await page.$$eval('a[href*="/pilka-nozna-sfootball/"]', links => 
    links.slice(0, 5).map(a => ({
      href: a.href,
      text: a.textContent?.trim()
    }))
  );
  
  console.log('Found matches:');
  matchLinks.forEach((m, i) => {
    console.log(`${i + 1}. ${m.text}`);
    console.log(`   URL: ${m.href}`);
  });
  
  if (matchLinks.length > 0) {
    const matchId = matchLinks[0].href.match(/m(\d+)$/)?.[1];
    console.log(`\nFirst match ID: ${matchId}`);
  }
  
  await browser.close();
})();
