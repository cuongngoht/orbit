// How a chat runs, in the composer's toolbar: the model and its effort (one menu, the effort a submenu, as in Claude
// Code), and the mode -- Autonomous (Claude Code's auto mode) or Plan (its plan mode). The models and the efforts each
// takes are the signed-in account's own (services/models): a model a program gives the account appears for it alone.
import { Button, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Checkmark16Regular, ChevronDown12Regular, ClipboardTaskList16Regular, Flash16Regular } from "@fluentui/react-icons";
import { effortFor, effortLabel, MODE_CHOICES, MODE_LABELS, modelLabel, modelOf, type EffortChoice, type ModeChoice, type ModelCatalog, type ModelChoice } from "@orbit-web/contracts";
import { useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import { useViewport } from "../../hooks/useViewport";
import { useModelCatalog } from "../../services/models/ModelCatalog";

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

// Whether Autonomous may be chosen with this model (the fallback list says yes to all: the CLI decides).
export const autoModeWith = (catalog: ModelCatalog, model: ModelChoice): boolean => modelOf(catalog, model)?.autoMode ?? true;

// The models to offer: the account's, and -- when it is not among them -- the one chosen now, said to be unavailable.
function choicesOf(catalog: ModelCatalog, model: ModelChoice): { id: ModelChoice; label: string; hint: string | null }[] {
  const listed = catalog.models.map((m) => ({ id: m.id, label: m.label, hint: m.autoMode ? null : "Plan only" }));
  return listed.some((m) => m.id === model) ? listed : [...listed, { id: model, label: modelLabel(model, catalog), hint: catalog.source === "account" ? "Not available to this account" : null }];
}

export function ModelEffortPicker({ model, effort, onModel, onEffort, disabled = false }: { model: ModelChoice; effort: EffortChoice; onModel: (m: ModelChoice) => void; onEffort: (e: EffortChoice) => void; disabled?: boolean }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const catalog = useModelCatalog();
  const option = modelOf(catalog, model);
  const efforts = option?.efforts ?? ["low", "medium", "high", "xhigh", "max"];
  const choices = choicesOf(catalog, model);
  const modelText = modelLabel(model, catalog);
  const effortText = efforts.length === 0 ? "No effort level" : effortLabel(effort);
  // A model whose efforts do not hold the one chosen now moves it to one it takes.
  const pick = (m: ModelChoice) => {
    onModel(m);
    const next = effortFor(modelOf(catalog, m), effort);
    if (next !== null && next !== effort) onEffort(next);
  };

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
          aria-label={`Model ${modelText}, effort ${effortText}`}
          onClick={() => setOpen(true)}
        >
          {modelText}
          <span className={s.effort}>{effortText}</span>
        </Button>
        <ResponsiveSheet open={open} onOpenChange={setOpen} title="Model & effort">
          <div className={s.section}>
            <Text size={100} weight="semibold" className={s.sectionLabel}>
              Model · this session
            </Text>
            {choices.map((m, i) => {
              const selected = model === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="menuitemradio"
                  aria-label={m.label}
                  aria-checked={selected}
                  className={mergeClasses(s.sheetCard, selected && s.sheetCardSelected)}
                  onClick={() => pick(m.id)}
                >
                  <span className={s.sheetCardMeta}>
                    <span className={s.sheetCardTitle}>{m.label}</span>
                    {m.hint && <span className={s.modeHint}>{m.hint}</span>}
                  </span>
                  {selected ? <Checkmark16Regular /> : <Text size={200} aria-hidden>{String(i + 1)}</Text>}
                </button>
              );
            })}
          </div>
          <div className={s.section}>
            <Text size={100} weight="semibold" className={s.sectionLabel}>
              Effort
            </Text>
            {efforts.length === 0 && (
              <Text size={200} className={s.noteSheet}>
                {option?.label ?? "This model"} takes no effort level.
              </Text>
            )}
            <div className={s.effortGrid}>
              {efforts.map((e) => {
                const selected = effort === e;
                return (
                  <button
                    key={e}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    aria-label={e === "medium" ? `${effortLabel(e)} (Recommended)` : effortLabel(e)}
                    className={mergeClasses(s.effortPill, selected && s.effortPillSelected)}
                    onClick={() => onEffort(e)}
                  >
                    <span>{effortLabel(e)}</span>
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
    <Menu checkedValues={{ model: [model] }} onCheckedValueChange={(_, d) => d.name === "model" && d.checkedItems[0] && pick(d.checkedItems[0] as ModelChoice)}>
      <MenuTrigger disableButtonEnhancement>
        <Button className={s.trigger} appearance="subtle" size="small" disabled={disabled} icon={<ChevronDown12Regular />} iconPosition="after" aria-label={`Model ${modelText}, effort ${effortText}`}>
          {modelText}
          <span className={s.effort}>{effortText}</span>
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>Model · this session</MenuGroupHeader>
            {choices.map((m, i) => (
              <MenuItemRadio key={m.id} name="model" value={m.id} secondaryContent={m.hint ?? String(i + 1)}>
                {m.label}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          {efforts.length === 0 ? (
            <MenuItem disabled secondaryContent="—">
              No effort level
            </MenuItem>
          ) : (
            <Menu checkedValues={{ effort: [effort] }} onCheckedValueChange={(_, d) => d.name === "effort" && d.checkedItems[0] && onEffort(d.checkedItems[0] as EffortChoice)}>
              <MenuTrigger disableButtonEnhancement>
                <MenuItem secondaryContent={effortText}>Effort</MenuItem>
              </MenuTrigger>
              <MenuPopover>
                <Text size={200} className={s.note}>
                  Higher effort means more thorough responses, but takes longer and uses your limits faster.
                </Text>
                <MenuList>
                  {efforts.map((e) => (
                    <MenuItemRadio key={e} name="effort" value={e}>
                      {effortLabel(e)}
                      {e === "medium" && <span className={s.recommended}>Recommended</span>}
                    </MenuItemRadio>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

// `autoMode` false: Autonomous is not available with the chosen model (the account's catalog says so).
export function ModePicker({ mode, onMode, disabled = false, autoMode = true }: { mode: ModeChoice; onMode: (m: ModeChoice) => void; disabled?: boolean; autoMode?: boolean }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const icon = mode === "plan" ? <ClipboardTaskList16Regular /> : <Flash16Regular />;
  const unavailable = (m: ModeChoice) => m === "autonomous" && !autoMode;
  const hint = (m: ModeChoice) => (unavailable(m) ? "Not available with this model: it plans only." : MODE_HINTS[m]);

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
                disabled={unavailable(m)}
                className={mergeClasses(s.sheetCard, selected && s.sheetCardSelected)}
                onClick={() => {
                  onMode(m);
                  setOpen(false);
                }}
              >
                {m === "plan" ? <ClipboardTaskList16Regular /> : <Flash16Regular />}
                <span className={s.sheetCardMeta}>
                  <span className={s.sheetCardTitle}>{MODE_LABELS[m]}</span>
                  <span className={s.modeHint}>{hint(m)}</span>
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
            <MenuItemRadio key={m} name="mode" value={m} disabled={unavailable(m)} icon={m === "plan" ? <ClipboardTaskList16Regular /> : <Flash16Regular />}>
              <span className={s.mode}>
                {MODE_LABELS[m]}
                <span className={s.modeHint}>{hint(m)}</span>
              </span>
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
