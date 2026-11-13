/**
 * Scraper types for fetching odds from Polish bookmakers
 */

import type { PolishBookmaker } from "../config/index.js";

// Scraper configuration
export interface ScraperConfig {
  bookmaker: PolishBookmaker;
  type: "api" | "headless";
  baseUrl: string;
  timeout: number;
  retries: number;
  rateLimit: number; // requests per minute
  enabled: boolean;
  disableResourceBlocking?: boolean; // Some scrapers need full page load (WebSocket-based)
}

// Default scraper configs
export const DEFAULT_SCRAPER_CONFIGS: Record<PolishBookmaker, ScraperConfig> = {
  betclic: {
    bookmaker: "betclic",
    type: "api",
    baseUrl: "https://offer.cdn.begmedia.com/api/pub/v2",
    timeout: 10000,
    retries: 3,
    rateLimit: 60,
    enabled: true,
  },
  fortuna: {
    bookmaker: "fortuna",
    type: "api",
    baseUrl: "https://api.efortuna.pl",
    timeout: 10000,
    retries: 3,
    rateLimit: 60,
    enabled: true,
  },
  sts: {
    bookmaker: "sts",
    type: "headless",
    baseUrl: "https://www.sts.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  superbet: {
    bookmaker: "superbet",
    type: "headless",
    baseUrl: "https://www.superbet.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  lvbet: {
    bookmaker: "lvbet",
    type: "headless",
    baseUrl: "https://www.lvbet.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  fuksiarz: {
    bookmaker: "fuksiarz",
    type: "headless",
    baseUrl: "https://www.fuksiarz.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  betfan: {
    bookmaker: "betfan",
    type: "headless",
    baseUrl: "https://www.betfan.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  totalbet: {
    bookmaker: "totalbet",
    type: "headless",
    baseUrl: "https://www.totalbet.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  forbet: {
    bookmaker: "forbet",
    type: "headless",
    baseUrl: "https://www.iforbet.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  etoto: {
    bookmaker: "etoto",
    type: "headless",
    baseUrl: "https://www.etoto.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  betters: {
    bookmaker: "betters",
    type: "headless",
    baseUrl: "https://www.betters.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  lebull: {
    bookmaker: "lebull",
    type: "headless",
    baseUrl: "https://www.lebull.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
  },
  betcris: {
    bookmaker: "betcris",
    type: "headless",
    baseUrl: "https://www.betcris.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
    disableResourceBlocking: true, // Uses WebSocket for Swarm API data
  },
  pzbuk: {
    bookmaker: "pzbuk",
    type: "headless",
    baseUrl: "https://www.pzbuk.pl",
    timeout: 15000,
    retries: 2,
    rateLimit: 20,
    enabled: true,
    disableResourceBlocking: true, // Uses WebSocket for RSocket data
  },
};
