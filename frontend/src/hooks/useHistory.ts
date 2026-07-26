import { useQuery } from "@tanstack/react-query";
import { fetchHistory } from "@/api/history";

/** React Query wrapper around the mocked GET /history endpoint. */
export function useHistory() {
  return useQuery({
    queryKey: ["history"],
    queryFn: fetchHistory,
    staleTime: 0,
  });
}
