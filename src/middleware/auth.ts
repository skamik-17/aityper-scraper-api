/**
 * Authentication middleware
 */

import type { Request, Response, NextFunction } from "express";
import { CONFIG } from "../config/index.js";
import { ApiError } from "./error-handler.js";
import { ERROR_CODES } from "../types/api.js";

/**
 * Verify admin API key for protected endpoints
 */
export function requireAdminAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Missing authorization header");
  }

  // Expect "Bearer <token>"
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Invalid authorization format");
  }

  const token = parts[1];

  if (token !== CONFIG.ADMIN_API_KEY) {
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Invalid API key");
  }

  next();
}
