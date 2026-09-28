interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  invalid?: boolean;
  inputMode?: 'decimal' | 'numeric';
  placeholder?: string;
  onBlur?: () => void;
}

export function AmountField({ id, label, value, onChange, invalid = false, inputMode = 'decimal', placeholder = '0', onBlur }: Props) {
  return (
    <input
      id={id}
      className="field"
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode={inputMode}
      autoComplete="off"
      enterKeyHint="next"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}
