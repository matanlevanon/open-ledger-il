import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from 'react';

interface FieldWrapperProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (ids: { fieldId: string; describedBy: string | undefined }) => ReactNode;
}

function FieldWrapper({ label, error, hint, required, children }: FieldWrapperProps) {
  const fieldId = useId();
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
        {required && <span aria-hidden className="ms-0.5 text-danger">*</span>}
      </label>
      {children({ fieldId, describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const fieldClass =
  'rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:opacity-60';
const invalidClass = 'border-danger';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & { label: string; error?: string; hint?: string };

export function TextField({ label, error, hint, required, className, ...rest }: TextFieldProps) {
  // Numbers and dates stay left-to-right even in an RTL interface (R16 task 16), whatever the
  // page direction is.
  const dir = rest.type === 'number' || rest.type === 'date' ? 'ltr' : undefined;
  return (
    <FieldWrapper label={label} error={error} hint={hint} required={required}>
      {({ fieldId, describedBy }) => (
        <input
          id={fieldId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          dir={dir}
          className={`${fieldClass} ${error ? invalidClass : ''} ${className ?? ''}`}
          {...rest}
        />
      )}
    </FieldWrapper>
  );
}

type TextareaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string;
  error?: string;
  hint?: string;
};

export function TextareaField({ label, error, hint, required, className, ...rest }: TextareaFieldProps) {
  return (
    <FieldWrapper label={label} error={error} hint={hint} required={required}>
      {({ fieldId, describedBy }) => (
        <textarea
          id={fieldId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={`${fieldClass} ${error ? invalidClass : ''} ${className ?? ''}`}
          {...rest}
        />
      )}
    </FieldWrapper>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
};

export function SelectField({ label, error, hint, required, className, options, ...rest }: SelectFieldProps) {
  return (
    <FieldWrapper label={label} error={error} hint={hint} required={required}>
      {({ fieldId, describedBy }) => (
        <select
          id={fieldId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={`${fieldClass} ${error ? invalidClass : ''} ${className ?? ''}`}
          {...rest}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </FieldWrapper>
  );
}
