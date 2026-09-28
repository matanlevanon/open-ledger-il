import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import type { ChipTone } from './StatusChip';

interface ToastMessage {
  id: number;
  text: string;
  tone: Extract<ChipTone, 'brand' | 'success' | 'danger'>;
}

interface ToastContextValue {
  push: (text: string, tone?: ToastMessage['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastMessage['tone'], string> = {
  brand: 'bg-brand text-brand-ink',
  success: 'bg-success text-brand-ink',
  danger: 'bg-danger text-brand-ink',
};

let nextId = 1;

/** Wrap the app once. Any screen calls `useToast().push(...)` to show a short message. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const push = useCallback((text: string, tone: ToastMessage['tone'] = 'brand') => {
    const id = nextId++;
    setToasts((list) => [...list, { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 end-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`rounded-md px-4 py-2 text-sm shadow-card ${TONE_CLASS[t.tone]}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider');
  return ctx;
}
