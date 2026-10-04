const { ApiError } = require('./errors');

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Request body is invalid.', result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message
      }))));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };