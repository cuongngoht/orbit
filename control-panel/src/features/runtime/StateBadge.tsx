import { Badge } from "@fluentui/react-components";
import { toneOf } from "./runtimeWords";

// One engine word, one colour. The colour is the table's (runtimeWords.ts), never a judgement made
// where the badge is drawn, so the same word reads the same on every card.
export function StateBadge({ word, label }: { word: string; label?: string }) {
  return (
    <Badge appearance="tint" color={toneOf(word)}>
      {label ?? word}
    </Badge>
  );
}
