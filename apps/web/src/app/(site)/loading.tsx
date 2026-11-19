import { Skeleton, SkeletonText } from "@eddy/ui";

/** Every student page while it loads: the page's shape, quietly, with no spinner. */
export default function Loading() {
  return (
    <main
      id="main"
      aria-busy="true"
      className="max-w-[68ch] px-4 py-8 md:ml-[10vw] md:border-l md:border-rule md:px-8 md:py-12"
    >
      <p className="sr-only">Loading</p>
      <Skeleton className="mb-6 h-10 w-1/2" />
      <SkeletonText lines={4} />
    </main>
  );
}
