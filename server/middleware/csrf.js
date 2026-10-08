const { ApiError } = require('./errors');

function configuredOrigins() {
  return [process.env.APP_BASE_URL, process.env.CLIENT_ORIGIN]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((value) => new URL(value.trim()).origin);
}

function csrfProtection(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.is('application/json')) {
    return next(new ApiError(415, 'JSON_REQUIRED', 'State-changing API requests must use application/json.'));
  }

  const source = req.get('origin') || req.get('referer');
  if (!source) {
    return next(new ApiError(403, 'CSRF_ORIGIN_REQUIRED', 'An allowed Origin or Referer header is required.'));
  }

  let sourceOrigin;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    return next(new ApiError(403, 'CSRF_ORIGIN_DENIED', 'Request origin is not allowed.'));
  }

  if (!configuredOrigins().includes(sourceOrigin)) {
    return next(new ApiError(403, 'CSRF_ORIGIN_DENIED', 'Request origin is not allowed.'));
  }
  next();
}

module.exports = { csrfProtection };