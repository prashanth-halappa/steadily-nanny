// API response envelope types shared between the API and its clients.
import type { ErrorCode } from './errorCodes';

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  message: string;
  data: T;
  timestamp: string;
  requestId: string;
}

export interface ValidationErrorDetail {
  path: (string | number)[];
  message: string;
  code: string;
  received?: unknown;
  expected?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ValidationErrorDetail[] | Record<string, unknown>;
    field?: string;
  };
  timestamp: string;
  path: string;
  requestId: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

export interface CursorPagination {
  limit: number;
  hasNextPage: boolean;
  nextCursor?: string;
}

export interface CursorPaginatedResponse<T> {
  items: T[];
  pagination: CursorPagination;
}
