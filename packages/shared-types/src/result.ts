/**
 * Type-safe Result pattern for explicit error handling.
 *
 * Use this instead of throwing exceptions to make error handling explicit
 * and type-checked. TypeScript will force callers to handle both success
 * and failure cases.
 *
 * @example
 * // Service returns Result instead of throwing
 * async function loadUser(id: string): Promise<Result<User, UserNotFoundError>> {
 *   const user = await db.findUser(id);
 *   if (!user) {
 *     return Result.fail(new UserNotFoundError(id));
 *   }
 *   return Result.ok(user);
 * }
 *
 * // Caller MUST handle both cases
 * const result = await loadUser(id);
 * if (!result.success) {
 *   // TypeScript knows result.error exists here
 *   return handleError(result.error);
 * }
 * // TypeScript knows result.data exists here
 * return result.data;
 */

/**
 * Represents a successful result containing data of type T.
 */
export interface Success<T> {
  readonly success: true;
  readonly data: T;
}

/**
 * Represents a failed result containing an error of type E.
 */
export interface Failure<E> {
  readonly success: false;
  readonly error: E;
}

/**
 * A discriminated union type representing either success with data
 * or failure with an error. Forces explicit handling of both cases.
 */
export type Result<T, E = Error> = Success<T> | Failure<E>;

/**
 * Utility functions for creating Result values.
 */
export const Result = {
  /**
   * Creates a successful Result containing the given data.
   */
  ok<T>(data: T): Success<T> {
    return { success: true, data };
  },

  /**
   * Creates a failed Result containing the given error.
   */
  fail<E>(error: E): Failure<E> {
    return { success: false, error };
  },

  /**
   * Type guard to check if a Result is successful.
   */
  isOk<T, E>(result: Result<T, E>): result is Success<T> {
    return result.success === true;
  },

  /**
   * Type guard to check if a Result is a failure.
   */
  isFail<T, E>(result: Result<T, E>): result is Failure<E> {
    return result.success === false;
  },

  /**
   * Wraps a Promise that might throw into a Result.
   * Useful for wrapping external APIs that use exceptions.
   */
  async fromPromise<T, E = Error>(
    promise: Promise<T>,
    errorMapper?: (error: unknown) => E
  ): Promise<Result<T, E>> {
    try {
      const data = await promise;
      return Result.ok(data);
    } catch (error) {
      const mappedError = errorMapper ? errorMapper(error) : (error as E);
      return Result.fail(mappedError);
    }
  },

  /**
   * Maps the data of a successful Result using the provided function.
   * If the Result is a failure, returns it unchanged.
   */
  map<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
    if (result.success) {
      return Result.ok(fn(result.data));
    }
    return result;
  },

  /**
   * Maps the error of a failed Result using the provided function.
   * If the Result is successful, returns it unchanged.
   */
  mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    if (!result.success) {
      return Result.fail(fn(result.error));
    }
    return result;
  },

  /**
   * Chains Result-returning operations. If the input is successful,
   * applies fn to the data. If failed, returns the failure unchanged.
   */
  flatMap<T, U, E>(
    result: Result<T, E>,
    fn: (data: T) => Result<U, E>
  ): Result<U, E> {
    if (result.success) {
      return fn(result.data);
    }
    return result;
  },

  /**
   * Extracts the data from a Result or returns a default value if failed.
   */
  getOrElse<T, E>(result: Result<T, E>, defaultValue: T): T {
    if (result.success) {
      return result.data;
    }
    return defaultValue;
  },

  /**
   * Extracts the data from a Result or throws the error if failed.
   * Use sparingly - prefer explicit error handling.
   */
  getOrThrow<T, E extends Error>(result: Result<T, E>): T {
    if (result.success) {
      return result.data;
    }
    throw result.error;
  },
};
