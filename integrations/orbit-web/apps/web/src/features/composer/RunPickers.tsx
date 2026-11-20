// How a chat runs, in the composer's toolbar: the model and its effort (one menu, the effort a submenu, as in Claude
// Code), and the mode -- Autonomous (Claude Code's auto mode) or Plan (its plan mode). Each value is the CLI's own word,
// from the closed lists in contracts.
import { Button, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Checkmark16Regular, ChevronDown12Regular, ClipboardTaskList16Regular, Flash16Regular } from "@fluentui/react-icons";
import { EFFORT_CHOICES, EFFORT_LABELS, MODE_CHOICES, MODE_LABELS, MODEL_CHOICES, MODEL_LABELS, type EffortChoice, type ModeChoice, type ModelChoice } from "@orbit-web/contracts";
import { useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import { useViewport } from "../../hooks/useViewport";

const useStyles = makeStyles({
  trigger: {
    minWidth: "unset",
    minHeight: "30px",
    flexShrink: 0,
    borderRadius: "9999px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    transitionProperty: "background-color, color",
    transitionDuration: "140ms",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  triggerMobile: {
    minHeight: "34px",
    borderRadius: "9999px",
    paddingTop: "0",
    paddingRight: "10px",
    paddingBottom: "0",
    paddingLeft: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", "transparent"),
  },
  effort: { color: tokens.colorNeutralForeground3, marginLeft: "6px" },
  note: { display: "block", maxWidth: "260px", paddingTop: "6px", paddingRight: "10px", paddingBottom: "8px", paddingLeft: "10px", color: tokens.colorNeutralForeground3 },
  noteSheet: { display: "block", color: tokens.colorNeutralForeground3 },
  recommended: { marginLeft: "8px", paddingTop: 0, paddingRight: "6px", paddingBottom: 0, paddingLeft: "6px", borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase100 },
  mode: { display: "flex", flexDirection: "column" },
  modeHint: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  section: { display: "flex", flexDirection: "column", gap: "8px" },
  sectionLabel: { color: tokens.colorNeutralForeground3, textTransform: "uppercase", letterSpacing: "0.04em" },
  sheetCard: {
    width: "100%",
    minHeight: "48px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "14px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-card-bg)",
    color: tokens.colorNeutralForeground1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    textAlign: "left",
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
  },
  sheetCardSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  sheetCardTitle: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 },
  sheetCardMeta: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1 },
  effortGrid: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "6px" },
  effortPill: {
    minHeight: "44px",
    paddingTop: "4px",
    paddingRight: "4px",
    paddingBottom: "4px",
    paddingLeft: "4px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
  },
  effortPillSelected: {
    backgroundColor: tokens.colorBrandBackground,
    ...shorthands.borderColor(tokens.colorBrandBackground),
    color: tokens.colorNeutralForegroundOnBrand,
  },
  effortStar: { fontSize: "10px", opacity: 0.85 },
});

export const MODE_HINTS: Record<ModeChoice, string> = {
  autonomous: "Works on its own; a classifier reviews each action before it runs.",
  plan: "Reads and plans; changes nothing until you switch to Autonomous.",
};

export function ModelEffortPicker({ model, effort, onModel, onEffort, disabled = false }: { model: ModelChoice; effort: EffortChoice; onModel: (m: ModelChoice) => void; onEffort: (e: EffortChoice) => void; disabled?: boolean }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <>
        <Button
          className={mergeClasses(s.trigger, s.triggerMobile)}
          appearance="subtle"
          size="small"
          disabled={disabled}
          icon={<ChevronDown12Regular />}
          iconPosition="after"
          aria-label={`Model ${MODEL_LABELS[model]}, effort ${EFFORT_LABELS[effort]}`}
          onClick={() => setOpen(true)}
        >
          {MODEL_LABELS[model]}
          <span className={s.effort}>{EFFORT_LABELS[effort]}</span>
        </Button>
        <ResponsiveSheet open={open} onOpenChange={setOpen} title="Model & effort">
          <div className={s.section}>
            <Text size={100} weight="semibold" className={s.sectionLabel}>
              Model · this session
            </Text>
            {MODEL_CHOICES.map((m, i) => {
              const selected = model === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="menuitemradio"
                  aria-label={MODEL_LABELS[m]}
                  aria-checked={selected}
                  className={mergeClasses(s.sheetCard, selected && s.sheetCardSelected)}
                  onClick={() => onModel(m)}
                >
                  <span className={s.sheetCardTitle}>{MODEL_LABELS[m]}</span>
                  {selected ? <Checkmark16Regular /> : <Text size={200} aria-hidden>{String(i + 1)}</Text>}
                </button>
              );
            })}
          </div>
          <div className={s.section}>
            <Text size={100} weight="semibold" className={s.sectionLabel}>
              Effort
            </Text>
            <div className={s.effortGrid}>
              {EFFORT_CHOICES.map((e) => {
                const selected = effort === e;
                return (
                  <button
                    key={e}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    aria-label={e === "medium" ? `${EFFORT_LABELS[e]} (Recommended)` : EFFORT_LABELS[e]}
                    className={mergeClasses(s.effortPill, selected && s.effortPillSelected)}
                    onClick={() => onEffort(e)}
                  >
                    <span>{EFFORT_LABELS[e]}</span>
                    {e === "medium" && <span className={s.effortStar}>★</span>}
                  </button>
                );
              })}
            </div>
            <Text size={200} className={s.noteSheet}>
              Higher effort means more thorough responses, but takes longer and uses your limits faster.
            </Text>
          </div>
        </ResponsiveSheet>
      </>
    );
  }

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
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const icon = mode === "plan" ? <ClipboardTaskList16Regular /> : <Flash16Regular />;

  if (isMobile) {
    return (
      <>
        <Button
          className={mergeClasses(s.trigger, s.triggerMobile)}
          appearance="subtle"
          size="small"
          disabled={disabled}
          icon={icon}
          aria-label={`Mode ${MODE_LABELS[mode]}`}
          onClick={() => setOpen(true)}
        >
          {MODE_LABELS[mode]}
        </Button>
        <ResponsiveSheet open={open} onOpenChange={setOpen} title="Mode">
          {MODE_CHOICES.map((m) => {
            const selected = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={mergeClasses(s.sheetCard, selected && s.sheetCardSelected)}
                onClick={() => {
                  onMode(m);
                  setOpen(false);
                }}
              >
                {m === "plan" ? <ClipboardTaskList16Regular /> : <Flash16Regular />}
                <span className={s.sheetCardMeta}>
                  <span className={s.sheetCardTitle}>{MODE_LABELS[m]}</span>
                  <span className={s.modeHint}>{MODE_HINTS[m]}</span>
                </span>
                {selected && <Checkmark16Regular />}
              </button>
            );
          })}
        </ResponsiveSheet>
      </>
    );
  }

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
