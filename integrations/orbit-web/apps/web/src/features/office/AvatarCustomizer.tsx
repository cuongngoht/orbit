// REUSABLE AVATAR CUSTOMIZER: shared between TeammateSpotlight on the Virtual Workplace floor and the Employee Profile
// hero card so users can personalize any teammate's outfit color, hair color, hairstyle, and accessory from either screen.
import { Button, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { useI18n, type MessageKey } from "../../i18n";
import { AVATAR_HAIRS, AVATAR_SHIRT_SWATCHES, type AvatarAccessory, type AvatarCustomization, type AvatarHairStyle } from "./floorPrefs";

const HAIR_STYLE_KEYS: readonly [AvatarHairStyle, MessageKey][] = [
  [0, "office.floor.hairStyle.0"],
  [1, "office.floor.hairStyle.1"],
  [2, "office.floor.hairStyle.2"],
  [3, "office.floor.hairStyle.3"],
  [4, "office.floor.hairStyle.4"],
  [5, "office.floor.hairStyle.5"],
];

const ACCESSORY_KEYS: readonly [AvatarAccessory, MessageKey][] = [
  [0, "office.floor.accessoryNone"],
  [1, "office.floor.accessoryGlasses"],
  [2, "office.floor.accessoryHeadset"],
  [3, "office.floor.accessoryBeanie"],
  [4, "office.floor.accessoryScarf"],
];

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  label: {
    minWidth: "60px",
    color: tokens.colorNeutralForeground3,
  },
  swatchBtn: {
    width: "20px",
    height: "20px",
    borderRadius: "9999px",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    cursor: "pointer",
    ...shorthands.border("2px", "solid", "transparent"),
    transitionProperty: "transform, border-color",
    transitionDuration: "120ms",
    ":hover": { transform: "scale(1.12)" },
    ":focus-visible": { ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2), outlineOffset: "2px" },
  },
  swatchOn: {
    ...shorthands.borderColor(tokens.colorNeutralForeground1),
    transform: "scale(1.1)",
  },
});

export function AvatarCustomizer({
  value,
  onChange,
}: {
  value?: AvatarCustomization;
  onChange: (next: AvatarCustomization | null) => void;
}) {
  const { t } = useI18n();
  const s = useStyles();

  return (
    <div className={s.root}>
      <div className={s.row}>
        <Text size={100} weight="semibold" className={s.label}>
          {t("office.floor.shirtColor")}
        </Text>
        {AVATAR_SHIRT_SWATCHES.map((hex, idx) => (
          <button
            key={hex}
            type="button"
            className={mergeClasses(s.swatchBtn, value?.shirt === idx && s.swatchOn)}
            style={{ backgroundColor: hex }}
            aria-label={`${t("office.floor.shirtColor")} ${idx + 1}`}
            aria-pressed={value?.shirt === idx}
            onClick={() => onChange({ ...value, shirt: idx })}
          />
        ))}
      </div>

      <div className={s.row}>
        <Text size={100} weight="semibold" className={s.label}>
          {t("office.floor.hairColor")}
        </Text>
        {AVATAR_HAIRS.map((h, idx) => (
          <button
            key={h.main}
            type="button"
            className={mergeClasses(s.swatchBtn, value?.hair === idx && s.swatchOn)}
            style={{ backgroundColor: h.main }}
            aria-label={`${t("office.floor.hairColor")} ${idx + 1}`}
            aria-pressed={value?.hair === idx}
            onClick={() => onChange({ ...value, hair: idx })}
          />
        ))}
      </div>

      <div className={s.row}>
        <Text size={100} weight="semibold" className={s.label}>
          {t("office.floor.hairStyle")}
        </Text>
        {HAIR_STYLE_KEYS.map(([code, key]) => (
          <Button
            key={code}
            size="small"
            appearance={value?.hairStyle === code ? "primary" : "subtle"}
            aria-pressed={value?.hairStyle === code}
            onClick={() => onChange({ ...value, hairStyle: code })}
          >
            {t(key)}
          </Button>
        ))}
      </div>

      <div className={s.row}>
        <Text size={100} weight="semibold" className={s.label}>
          {t("office.floor.accessoryLabel")}
        </Text>
        {ACCESSORY_KEYS.map(([code, key]) => (
          <Button
            key={code}
            size="small"
            appearance={value?.accessory === code ? "primary" : "subtle"}
            aria-pressed={value?.accessory === code}
            onClick={() => onChange({ ...value, accessory: code })}
          >
            {t(key)}
          </Button>
        ))}
        {value && (
          <Button size="small" appearance="subtle" onClick={() => onChange(null)}>
            {t("office.floor.resetLook")}
          </Button>
        )}
      </div>
    </div>
  );
}
