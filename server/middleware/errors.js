const { ZodError } = require('zod');

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = error.status || error.statusCode || (error instanceof ZodError ? 400 : 500);
  const invalidJson = error.type === 'entity.parse.failed';
  const code = invalidJson ? 'INVALID_JSON' : error.code || (error instanceof ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
  const message = invalidJson
    ? 'Request body must contain valid JSON.'
    : status >= 500 ? 'An unexpected server error occurred.' : error.message;
  const details = error instanceof ZodError
    ? error.issues.map(({ path, message: issueMessage }) => ({ path, message: issueMessage }))
    : invalidJson ? undefined : error.details;

  console.error(`[API Error] ${req.method} ${req.originalUrl} ${status} ${code}`, error);
  res.status(status).json({
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    }
  });
}

module.exports = { ApiError, errorHandler };