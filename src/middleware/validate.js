import { ValidationError } from '../errors/index.js';

/**
 * Express middleware factory that validates req.body against a Zod schema.
 * Usage: router.post('/path', validate(mySchema), handler)
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError(
        'Validation error',
        result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      );
    }
    req.validated = result.data;
    next();
  };
}

/**
 * Validates req.query against a Zod schema.
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      throw new ValidationError(
        'Validation error',
        result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      );
    }
    req.validatedQuery = result.data;
    next();
  };
}
