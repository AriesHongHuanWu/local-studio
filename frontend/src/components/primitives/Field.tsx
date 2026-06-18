import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

interface BaseFieldProps {
  label?: string;
  hint?: string;
}

export interface TextFieldProps
  extends BaseFieldProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  className?: string;
}

export function Field({ label, hint, className = '', id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={`al-field ${className}`}>
      {label && (
        <label className="al-field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <input id={fieldId} className="al-field__input" {...rest} />
      {hint && <span className="al-field__hint">{hint}</span>}
    </div>
  );
}

export interface TextAreaFieldProps
  extends BaseFieldProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  className?: string;
  /** Use the serif document font (reference-lyrics editor). */
  serif?: boolean;
}

export function TextAreaField({
  label,
  hint,
  className = '',
  serif = false,
  id,
  style,
  ...rest
}: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={`al-field ${className}`}>
      {label && (
        <label className="al-field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        className="al-field__textarea"
        style={serif ? { fontFamily: 'var(--al-font-display)', ...style } : style}
        {...rest}
      />
      {hint && <span className="al-field__hint">{hint}</span>}
    </div>
  );
}

export interface SelectFieldProps
  extends BaseFieldProps,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  className?: string;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  className = '',
  id,
  children,
  ...rest
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={`al-field ${className}`}>
      {label && (
        <label className="al-field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <select id={fieldId} className="al-field__select" {...rest}>
        {children}
      </select>
      {hint && <span className="al-field__hint">{hint}</span>}
    </div>
  );
}
