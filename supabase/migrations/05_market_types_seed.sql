-- Market types seed — moved to runtime.
--
-- This migration previously contained INSERTs for ~200 market_types rows plus
-- ~95 UPDATEs setting sub_category. Every row was duplicated in
-- backend/src/data/market-catalog.ts (source of truth for the scraper +
-- normalization pipeline).
--
-- The backend now runs syncMarketTypes() on startup
-- (backend/src/services/market-types-sync.ts), which idempotently UPSERTs every
-- catalog entry into market_types. That removed the dual-source drift: the
-- catalog was gaining new numericIds (e.g. 1000, 417) that never landed in the
-- DB seed, causing FK violations during scraper batch inserts.
--
-- This file is intentionally a no-op so the migration sequence stays unbroken.
-- Fresh databases get populated on first backend boot.

SELECT 1;
