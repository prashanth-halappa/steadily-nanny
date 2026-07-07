/**
 * Classifies an unknown thrown value into a coarse variant so UI can pick the
 * right empty/error state (icon, copy, retry affordance) without re-parsing the
 * error at every call site.
 */
export function getErrorVariant(
  error: unknown
): 'network' | 'server' | 'auth' | 'notFound' {
  if (!error) return 'server';
  // ZodError indicates a client-side parsing issue, not a server error
  if (error instanceof Error && error.name === 'ZodError') return 'server';
  const axiosError = error as {
    isAxiosError?: boolean;
    response?: { status?: number };
    message?: string;
  };
  if (axiosError.isAxiosError && !axiosError.response) return 'network';
  if (axiosError.message?.toLowerCase().includes('network')) return 'network';
  const status = axiosError.response?.status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'notFound';
  return 'server';
}
