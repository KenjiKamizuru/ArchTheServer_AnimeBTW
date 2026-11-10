import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

type ToastKind = 'ok' | 'err'
interface Toast {
  id: number
  message: string
  kind: ToastKind
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((message: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list.slice(-3), { id, message, kind }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 md:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-fade-up flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm shadow-xl ring-1 backdrop-blur ${
              toast.kind === 'err'
                ? 'bg-red-950/90 text-red-100 ring-red-500/30'
                : 'bg-ink-800/95 text-white/90 ring-white/10'
            }`}
          >
            {toast.kind === 'err' ? (
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
            ) : (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" />
            )}
            <span className="leading-snug">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
