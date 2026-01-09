/**
 * Custom Error Classes
 *
 * Standardized error handling for the backend.
 */

/**
 * Error thrown by repository layer when database operations fail.
 * Services should catch this and decide how to handle.
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
