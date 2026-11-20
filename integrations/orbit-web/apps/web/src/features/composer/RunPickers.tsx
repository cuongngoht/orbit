// How a chat runs, in the composer's toolbar: the model and its effort (one menu, the effort a submenu, as in Claude
// Code), and the mode -- Autonomous (Claude Code's auto mode) or Plan (its plan mode). Each value is the CLI's own word,
// from the closed lists in contracts.
import { Button, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ChevronDown12Regular, ClipboardTaskList16Regular, Flash16Regular } from "@fluentui/react-icons";
import { EFFORT_CHOICES, EFFORT_LABELS, MODE_CHOICES, MODE_LABELS, MODEL_CHOICES, MODEL_LABELS, type EffortChoice, type ModeChoice, type ModelChoice } from "@orbit-web/contracts";

const useStyles = makeStyles({
  trigger: { minWidth: "unset", fontWeight: tokens.fontWeightRegular, color: tokens.colorNeutralForeground2 },
  effort: { color: tokens.colorNeutralForeground3, marginLeft: "6px" },
  note: { display: "block", maxWidth: "260px", padding: "6px 10px 8px", color: tokens.colorNeutralForeground3 },
  recommended: { marginLeft: "8px", padding: "0 6px", borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100 },
  mode: { display: "flex", flexDirection: "column" },
  modeHint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

export const MODE_HINTS: Record<ModeChoice, string> = {
  autonomous: "Works on its own; a classifier reviews each action before it runs.",
  plan: "Reads and plans; changes nothing until you switch to Autonomous.",
};

export function ModelEffortPicker({ model, effort, onModel, onEffort, disabled = false }: { model: ModelChoice; effort: EffortChoice; onModel: (m: ModelChoice) => void; onEffort: (e: EffortChoice) => void; disabled?: boolean }) {
  const s = useStyles();
  return (
    <Menu checkedValues={{ model: [model] }} onCheckedValueChange={(_, d) => d.name === "model" && d.checkedItems[0] && onModel(d.checkedItems[0] as ModelChoice)}>
      <MenuTrigger disableButtonEnhancement>
        <Button className={s.trigger} appearance="subtle" size="small" disabled={disabled} icon={<ChevronDown12Regular />} iconPosition="after" aria-label={`Model ${MODEL_LABELS[model]}, effort ${EFFORT_LABELS[effort]}`}>
          {MODEL_LABELS[model]}
          <span className={s.effort}>{EFFORT_LABELS[effort]}</span>
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>Model · this session</MenuGroupHeader>
            {MODEL_CHOICES.map((m, i) => (
              <MenuItemRadio key={m} name="model" value={m} secondaryContent={String(i + 1)}>
                {MODEL_LABELS[m]}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          <Menu checkedValues={{ effort: [effort] }} onCheckedValueChange={(_, d) => d.name === "effort" && d.checkedItems[0] && onEffort(d.checkedItems[0] as EffortChoice)}>
            <MenuTrigger disableButtonEnhancement>
              <MenuItem secondaryContent={EFFORT_LABELS[effort]}>Effort</MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <Text size={200} className={s.note}>
                Higher effort means more thorough responses, but takes longer and uses your limits faster.
              </Text>
              <MenuList>
                {EFFORT_CHOICES.map((e) => (
                  <MenuItemRadio key={e} name="effort" value={e}>
                    {EFFORT_LABELS[e]}
                    {e === "medium" && <span className={s.recommended}>Recommended</span>}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function ModePicker({ mode, onMode, disabled = false }: { mode: ModeChoice; onMode: (m: ModeChoice) => void; disabled?: boolean }) {
  const s = useStyles();
  const icon = mode === "plan" ? <ClipboardTaskList16Regular /> : <Flash16Regular />;
  return (
    <Menu checkedValues={{ mode: [mode] }} onCheckedValueChange={(_, d) => d.name === "mode" && d.checkedItems[0] && onMode(d.checkedItems[0] as ModeChoice)}>
      <MenuTrigger disableButtonEnhancement>
        <Button className={s.trigger} appearance="subtle" size="small" disabled={disabled} icon={icon} aria-label={`Mode ${MODE_LABELS[mode]}`}>
          {MODE_LABELS[mode]}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {MODE_CHOICES.map((m) => (
            <MenuItemRadio key={m} name="mode" value={m} icon={m === "plan" ? <ClipboardTaskList16Regular /> : <Flash16Regular />}>
              <span className={s.mode}>
                {MODE_LABELS[m]}
                <span className={s.modeHint}>{MODE_HINTS[m]}</span>
              </span>
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
