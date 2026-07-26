import { useQuery } from "@tanstack/react-query";
import { fetchBusinesses } from "@/api/businesses";

/**
 * Loads the business directory from the runtime and caches it. The directory
 * rarely changes within a session, so it's cached generously; a failure leaves
 * the list empty rather than crashing a screen.
 */
export function useBusinesses() {
  return useQuery({
    queryKey: ["businesses"],
    queryFn: fetchBusinesses,
    staleTime: 5 * 60 * 1000,
  });
}
