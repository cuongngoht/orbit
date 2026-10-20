import { useParams } from "react-router";
import type { CheckoutRef } from "./runtime.types";

// WHICH checkout a page is about, read off its address and nowhere else: a selector changes the
// address and a page reads it back, so there is no "current project" to fall out of step with what
// the person is looking at. Null when the address does not name both.
export function useCheckoutRef(): CheckoutRef | null {
  const { key, checkout } = useParams();
  return key && checkout ? { key, checkout } : null;
}
