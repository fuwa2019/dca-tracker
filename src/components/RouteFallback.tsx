/**
 * Placeholder shown while a lazily loaded route chunk is in flight.
 *
 * Route chunks are fetched on demand, so every navigation has a frame where the
 * page component does not exist yet. The fallback fills the route area instead
 * of collapsing it, so the chunk arriving cannot push already-painted content
 * around. It deliberately reuses the auth-loading visual from `RequireAuth` so
 * the two waits look like the same wait.
 */
export function RouteFallback() {
  return (
    <div className="flex min-h-full items-center justify-center" role="status" aria-busy="true">
      <div className="h-8 w-8 animate-pulse rounded-full bg-muted" aria-hidden="true" />
      <span className="sr-only">页面加载中</span>
    </div>
  );
}
