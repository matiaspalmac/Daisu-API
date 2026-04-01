import { AppError } from './AppError.js';

export class ValidationError extends AppError {
  constructor(message = 'Validation error', details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}
