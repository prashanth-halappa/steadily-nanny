/**
 * Toast notification helpers — a thin wrapper over toastify-react-native for
 * consistent success/error/info/warning toasts.
 *
 * import { showSuccessToast } from '@/src/lib/toast';
 * showSuccessToast('Saved!', 'Success');
 */
import { useCallback } from 'react';
import { Toast } from 'toastify-react-native';

export const showSuccessToast = (message: string, title?: string) => {
  Toast.success(title ? `${title}: ${message}` : message, 'top');
};

export const showErrorToast = (message: string, title?: string) => {
  Toast.error(title ? `${title}: ${message}` : message, 'top');
};

export const showInfoToast = (message: string, title?: string) => {
  Toast.info(title ? `${title}: ${message}` : message, 'top');
};

export const showWarningToast = (message: string, title?: string) => {
  // toastify-react-native has no dedicated warning variant; reuse info.
  Toast.info(title ? `${title}: ${message}` : message, 'top');
};

interface ToastOptions {
  title: string;
  description: string;
  variant?: 'default' | 'destructive' | 'success' | 'warning';
}

/** React hook wrapper for showing toasts from components. */
export function useToast() {
  const show = useCallback((options: ToastOptions) => {
    const { title, description, variant = 'default' } = options;
    const message = description || title;

    switch (variant) {
      case 'success':
        showSuccessToast(message, title);
        break;
      case 'destructive':
        showErrorToast(message, title);
        break;
      case 'warning':
        showWarningToast(message, title);
        break;
      default:
        showInfoToast(message, title);
        break;
    }
  }, []);

  return { show };
}
