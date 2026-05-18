/**
 * Input Validation Utilities
 *
 * Provides validation functions for user inputs to prevent:
 * - SQL injection
 * - XSS attacks
 * - Invalid data types
 * - Malformed inputs
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates a string ID (like achievement IDs)
 * Format: alphanumeric with hyphens, 1-100 characters
 */
export function validateId(id: unknown): ValidationResult {
  if (typeof id !== 'string') {
    return { isValid: false, error: 'ID must be a string' };
  }

  if (id.length === 0) {
    return { isValid: false, error: 'ID cannot be empty' };
  }

  if (id.length > 100) {
    return { isValid: false, error: 'ID is too long (max 100 characters)' };
  }

  // Allow alphanumeric, hyphens, underscores only
  const idPattern = /^[a-zA-Z0-9_-]+$/;
  if (!idPattern.test(id)) {
    return { isValid: false, error: 'ID contains invalid characters' };
  }

  return { isValid: true };
}

/**
 * Validates a numeric ID
 */
export function validateNumericId(id: unknown): ValidationResult {
  if (typeof id === 'number') {
    if (!Number.isInteger(id) || id <= 0) {
      return { isValid: false, error: 'ID must be a positive integer' };
    }
    return { isValid: true };
  }

  if (typeof id === 'string') {
    const parsed = parseInt(id, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return { isValid: false, error: 'ID must be a positive integer' };
    }
    return { isValid: true };
  }

  return { isValid: false, error: 'ID must be a number' };
}

/**
 * Validates a URL
 */
export function validateUrl(url: unknown): ValidationResult {
  if (typeof url !== 'string') {
    return { isValid: false, error: 'URL must be a string' };
  }

  if (url.length === 0) {
    return { isValid: false, error: 'URL cannot be empty' };
  }

  if (url.length > 2048) {
    return { isValid: false, error: 'URL is too long (max 2048 characters)' };
  }

  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { isValid: false, error: 'URL must use HTTP or HTTPS protocol' };
    }

    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validates a general string input
 */
export function validateString(
  value: unknown,
  options: {
    minLength?: number;
    maxLength?: number;
    allowEmpty?: boolean;
    pattern?: RegExp;
    fieldName?: string;
  } = {}
): ValidationResult {
  const {
    minLength = 0,
    maxLength = 1000,
    allowEmpty = false,
    pattern,
    fieldName = 'Value',
  } = options;

  if (typeof value !== 'string') {
    return { isValid: false, error: `${fieldName} must be a string` };
  }

  if (!allowEmpty && value.length === 0) {
    return { isValid: false, error: `${fieldName} cannot be empty` };
  }

  if (value.length < minLength) {
    return { isValid: false, error: `${fieldName} must be at least ${minLength} characters` };
  }

  if (value.length > maxLength) {
    return { isValid: false, error: `${fieldName} is too long (max ${maxLength} characters)` };
  }

  if (pattern && !pattern.test(value)) {
    return { isValid: false, error: `${fieldName} format is invalid` };
  }

  return { isValid: true };
}

/**
 * Validates pagination parameters
 */
import { config } from '../../config/env.js';

export function validatePagination(params: { page?: unknown; limit?: unknown }): ValidationResult {
  const { page, limit } = params;
  const max = config.pagination.maxLimit;

  if (page !== undefined) {
    const pageNum = Number(page);
    if (isNaN(pageNum) || pageNum < 1) {
      return { isValid: false, error: 'Page must be a positive integer' };
    }
  }

  if (limit !== undefined) {
    const limitNum = Number(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > max) {
      return { isValid: false, error: `Limit must be between 1 and ${max}` };
    }
  }

  return { isValid: true };
}

/**
 * Sanitizes a string by removing potentially dangerous characters
 * Note: This is a basic sanitization. For production, consider using a library like DOMPurify
 */
export function sanitizeString(value: string): string {
  return value
    .replace(/[<>]/g, '') // Remove angle brackets (basic XSS protection)
    .trim();
}

/**
 * Helper to check if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Helper to check if a value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
