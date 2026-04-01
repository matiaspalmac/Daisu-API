/**
 * Centralized error handler middleware.
 * Must be registered as the LAST middleware in Express.
 */
export function errorHandler(err, req, res, _next) {
  // Handle CORS errors
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: 'Not allowed by CORS', code: 'CORS_ERROR' });
  }

  // Handle operational errors (thrown intentionally via custom error classes)
  if (err.isOperational) {
    const response = { error: err.message, code: err.code };
    if (err.details?.length) {
      response.details = err.details;
    }
    return res.status(err.statusCode).json(response);
  }

  // Unhandled / programmer errors
  console.error('[unhandled]', err.stack || err.message || err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
}
