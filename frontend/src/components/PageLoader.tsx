import { Loader2 } from "lucide-react";

type PageLoaderProps = {
  label?: string;
  className?: string;
};

/** Loader meant to live inside the content panel, so the shell stays visible. */
export function PageLoader({ label = "Loading page…", className = "" }: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-[50vh] w-full flex-col items-center justify-center gap-4 ${className}`}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 ring-1 ring-brand-500/15">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" strokeWidth={2.2} />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-surface-700">Just a moment</p>
        <p className="mt-1 text-xs font-medium text-surface-400">{label}</p>
      </div>
    </div>
  );
}
