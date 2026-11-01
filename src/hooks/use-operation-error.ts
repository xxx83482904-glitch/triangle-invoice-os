"use client";

import { useCallback, useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { operationFailureToast } from "@/lib/operation-feedback";

// A persistent local error plus a notification. Resetting the error never resets input or selection.
export function useOperationError(company: CompanyScope) {
  const [error, setValue] = useState("");
  const setError = useCallback((message: string) => {
    setValue(message);
    if (company === "JAPAN" && message) toast(operationFailureToast(message));
  }, [company]);
  return [error, setError] as const;
}
