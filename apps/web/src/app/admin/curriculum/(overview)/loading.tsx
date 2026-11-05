import { Skeleton, SkeletonText } from "@eddy/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the curriculum.</p>
      <Skeleton className="mb-8 h-10 w-64" />
      <SkeletonText lines={4} />
      <Skeleton className="mt-8 h-48 w-full" />
    </div>
  );
}
