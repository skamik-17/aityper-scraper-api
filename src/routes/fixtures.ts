/**
 * Fixtures endpoint — serves TSDB data cached in Supabase.
 * Frontend reads from here instead of calling TSDB directly.
 */

import { Router } from "express";
import type { ApiSuccessResponse } from "../types/api.js";
import { ApiError, asyncHandler } from "../middleware/error-handler.js";
import { ERROR_CODES } from "../types/api.js";
import {
  getTsdbFixtures,
  type TsdbFixtureRow,
} from "../repositories/tsdb-fixtures-repository.js";

const router = Router();

interface FixtureDto {
  id: string;
  leagueSlug: string;
  homeTeam: { id: string; name: string; badgeUrl?: string };
  awayTeam: { id: string; name: string; badgeUrl?: string };
  kickoffTime: string;
  venue?: string;
  round?: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
  halfTimeScore?: string;
}

function toDto(row: TsdbFixtureRow): FixtureDto {
  return {
    id: row.id,
    leagueSlug: row.league_slug,
    homeTeam: {
      id: row.home_team_id,
      name: row.home_team_name,
      badgeUrl: row.home_team_badge ?? undefined,
    },
    awayTeam: {
      id: row.away_team_id,
      name: row.away_team_name,
      badgeUrl: row.away_team_badge ?? undefined,
    },
    kickoffTime: row.kickoff_time,
    venue: row.venue ?? undefined,
    round: row.round !== null ? `Kolejka ${row.round}` : undefined,
    status: row.status,
    homeScore: row.home_score ?? undefined,
    awayScore: row.away_score ?? undefined,
    halfTimeScore: row.half_time_score ?? undefined,
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const league = req.query.league as string | undefined;
    if (!league) {
      throw new ApiError(400, ERROR_CODES.INVALID_PARAMS, "Missing required query param: league");
    }

    const upcoming = req.query.upcoming === "true";
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const rows = await getTsdbFixtures({ leagueSlug: league, upcoming, limit });
    const data: FixtureDto[] = rows.map(toDto);

    const response: ApiSuccessResponse<FixtureDto[], { league: string; count: number }> = {
      success: true,
      data,
      meta: { league, count: data.length },
    };

    res.json(response);
  })
);

export default router;
