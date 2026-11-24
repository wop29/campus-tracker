/** Placeholder shown while saved answers load, so the wizard never flashes an empty "nothing picked" state. */
export function OnboardingSkeleton() {
  const bar = 'animate-pulse rounded-2xl bg-border/60 motion-reduce:animate-none';
  return (
    <div className="w-full" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your answers...</span>
      <div className="mb-5 flex items-center justify-between gap-3" aria-hidden>
        <div className="flex gap-2">{[32, 12, 12, 12].map((w, i) => <span key={i} className={`h-3 rounded-full bg-border/60`} style={{ width: w }} />)}</div>
        <span className={`${bar} h-5 w-24`} />
      </div>
      <div className="mb-5 flex items-end gap-3" aria-hidden>
        <span className="h-[72px] w-[72px] shrink-0 animate-pulse rounded-full bg-border/60 motion-reduce:animate-none" />
        <span className={`${bar} h-12 flex-1`} />
      </div>
      <div aria-hidden>
        <span className={`${bar} mb-4 block h-8 w-3/4`} />
        <span className={`${bar} mb-3 block h-20`} />
        <span className={`${bar} block h-20`} />
      </div>
    </div>
  );
}
