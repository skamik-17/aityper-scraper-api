import * as fs from 'fs';
import * as path from 'path';

const INPUT_FILE = path.join(process.cwd(), 'logs/test_sts.txt');
const OUTPUT_DIR = path.join(process.cwd(), 'logs/sts-markets-analysis');

const MARKET_CATEGORIES: Record<string, number[]> = {
  'main-results': [1, 10, 11],
  'goals': [8, 9, 25, 28, 31, 33, 35, 36, 43, 44, 47, 48, 1224, 1229],
  'handicaps': [14, 17, 20, 22],
  'combinations': [49, 50, 51, 258, 807, 808, 809, 810, 811, 812],
  'first-half': [71, 73, 74, 75, 76, 77, 79, 80, 82, 85, 88, 90, 94, 95, 98, 99, 101],
  'second-half': [102, 103, 104, 105, 106, 107, 109, 110, 112, 115, 118, 119, 120, 121, 124],
  'correct-score': [283, 57],
  'time-based': [23, 40, 41, 42, 125, 126, 132],
  'half-analysis': [58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70],
  'player-markets': [52, 53, 54, 1051],
  'goal-ranges': [813, 814, 815, 816, 817, 818],
  'ht-ft-combos': [1012],
  'half-team-score': [1232, 1233, 1234, 1235],
  'other': [1244],
};

const PRIORITY_MARKETS = [57, 98, 816, 1012, 1232, 1233, 1234, 1235, 1244];

interface MarketSection {
  id: number;
  name: string;
  normalizedCode: string;
  startLine: number;
  endLine: number;
  content: string;
  needsWork: boolean;
}

function parseMarkets(content: string): MarketSection[] {
  const lines = content.split('\n');
  const markets: MarketSection[] = [];
  
  const marketHeaderRegex = /^📦 MARKET ID (\d+): (.+)$/;
  const normalizedRegex = /^✅ NORMALIZED: (.+)$/;
  
  let currentMarket: Partial<MarketSection> | null = null;
  let currentContent: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(marketHeaderRegex);
    
    if (headerMatch) {
      if (currentMarket && currentMarket.id !== undefined) {
        currentMarket.endLine = i;
        currentMarket.content = currentContent.join('\n');
        markets.push(currentMarket as MarketSection);
      }
      
      currentMarket = {
        id: parseInt(headerMatch[1]),
        name: headerMatch[2],
        normalizedCode: '',
        startLine: i + 1,
        needsWork: false,
      };
      currentContent = [line];
    } else if (currentMarket) {
      currentContent.push(line);
      
      const normalizedMatch = line.match(normalizedRegex);
      if (normalizedMatch) {
        currentMarket.normalizedCode = normalizedMatch[1];
        currentMarket.needsWork = normalizedMatch[1] === 'OTHER';
      }
    }
  }
  
  if (currentMarket && currentMarket.id !== undefined) {
    currentMarket.endLine = lines.length;
    currentMarket.content = currentContent.join('\n');
    markets.push(currentMarket as MarketSection);
  }
  
  return markets;
}

function getCategoryForMarket(marketId: number): string {
  for (const [category, ids] of Object.entries(MARKET_CATEGORIES)) {
    if (ids.includes(marketId)) {
      return category;
    }
  }
  return 'uncategorized';
}

function generateIndexFile(markets: MarketSection[], byCategory: Record<string, MarketSection[]>): string {
  let content = `# STS Market Analysis Index

Generated: ${new Date().toISOString()}
Total Markets: ${markets.length}

## Priority: Markets Mapped to OTHER

These markets need proper normalization and should be addressed first:

| ID | Polish Name | Current Code | Selections |
|----|-------------|--------------|------------|
`;
  
  const otherMarkets = markets.filter(m => m.normalizedCode === 'OTHER');
  for (const market of otherMarkets) {
    content += `| ${market.id} | ${market.name} | OTHER | - |\n`;
  }
  
  content += `\n## Markets by Category\n\n`;
  
  for (const [category, categoryMarkets] of Object.entries(byCategory).sort()) {
    const needsWork = categoryMarkets.filter(m => m.needsWork).length;
    content += `### ${category} (${categoryMarkets.length} markets${needsWork > 0 ? `, ${needsWork} need work` : ''})\n\n`;
    content += `| ID | Polish Name | Normalized Code | Status |\n`;
    content += `|----|-------------|-----------------|--------|\n`;
    
    for (const market of categoryMarkets.sort((a, b) => a.id - b.id)) {
      const status = market.needsWork ? 'NEEDS WORK' : 'OK';
      content += `| ${market.id} | ${market.name} | ${market.normalizedCode} | ${status} |\n`;
    }
    content += '\n';
  }
  
  return content;
}

function main() {
  console.log('Reading input file...');
  const content = fs.readFileSync(INPUT_FILE, 'utf-8');
  
  console.log('Parsing markets...');
  const markets = parseMarkets(content);
  
  console.log(`Found ${markets.length} markets`);
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const byCategory: Record<string, MarketSection[]> = {};
  for (const market of markets) {
    const category = getCategoryForMarket(market.id);
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(market);
  }
  
  for (const [category, categoryMarkets] of Object.entries(byCategory)) {
    const filename = `${category}.txt`;
    const filepath = path.join(OUTPUT_DIR, filename);
    
    const header = `=`.repeat(100) + '\n';
    const categoryHeader = `Category: ${category.toUpperCase()}\nMarkets: ${categoryMarkets.length}\n`;
    const separator = '='.repeat(100) + '\n\n';
    
    const fileContent = header + categoryHeader + separator + 
      categoryMarkets.map(m => m.content).join('\n\n');
    
    fs.writeFileSync(filepath, fileContent);
    console.log(`  Written: ${filename} (${categoryMarkets.length} markets)`);
  }
  
  const priorityMarkets = markets.filter(m => PRIORITY_MARKETS.includes(m.id));
  if (priorityMarkets.length > 0) {
    const priorityFile = path.join(OUTPUT_DIR, '_PRIORITY_OTHER_MARKETS.txt');
    const header = `${'='.repeat(100)}\nPRIORITY: Markets Currently Mapped to OTHER\nThese markets need proper normalization mappings\n${'='.repeat(100)}\n\n`;
    
    fs.writeFileSync(priorityFile, header + priorityMarkets.map(m => m.content).join('\n\n'));
    console.log(`  Written: _PRIORITY_OTHER_MARKETS.txt (${priorityMarkets.length} markets)`);
  }
  
  const indexContent = generateIndexFile(markets, byCategory);
  fs.writeFileSync(path.join(OUTPUT_DIR, '_INDEX.md'), indexContent);
  console.log('  Written: _INDEX.md');
  
  console.log('\nDone!');
}

main();
