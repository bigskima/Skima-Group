import {
  AlertCircle,
  Bell,
  Check,
  ChevronRight,
  Circle,
  Info,
  Loader2,
  LogOut,
  type LucideIcon,
  Menu,
  Search,
  ShieldAlert,
  UserCircle,
  X,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  createContext,
  default as React,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useContext,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
export type PermissionCheck = (permission: string) => boolean;

export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: LucideIcon;
  readonly badge?: string | number;
  readonly requiredPermissions?: readonly string[];
}

export interface TableColumn<TRecord> {
  readonly key: string;
  readonly header: ReactNode;
  readonly align?: "left" | "center" | "right";
  readonly minWidth?: string;
  readonly render: (record: TRecord) => ReactNode;
}

export interface StateAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: LucideIcon;
}

export interface OnboardingStepView {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly status: "locked" | "available" | "active" | "complete" | "skipped";
  readonly href?: string;
}

const PermissionContext = createContext<PermissionCheck>(() => true);

export function PermissionProvider(
  props: { readonly can: PermissionCheck; readonly children: ReactNode },
) {
  return (
    <PermissionContext.Provider value={props.can}>
      {props.children}
    </PermissionContext.Provider>
  );
}

export function usePermissionCheck(): PermissionCheck {
  return useContext(PermissionContext);
}

const buttonStyles = cva("sk-button", {
  variants: {
    variant: {
      primary: "sk-button--primary",
      secondary: "sk-button--secondary",
      outline: "sk-button--outline",
      ghost: "sk-button--ghost",
      destructive: "sk-button--destructive",
    },
    size: {
      sm: "sk-button--sm",
      md: "sk-button--md",
      lg: "sk-button--lg",
      icon: "sk-button--icon",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  readonly icon?: LucideIcon;
  readonly trailingIcon?: LucideIcon;
  readonly isLoading?: boolean;
  readonly requiredPermission?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    className,
    children,
    disabled,
    icon: Icon,
    trailingIcon: TrailingIcon,
    isLoading,
    requiredPermission,
    variant,
    size,
    type = "button",
    ...buttonProps
  } = props;
  const can = usePermissionCheck();
  const permissionDenied = requiredPermission ? !can(requiredPermission) : false;
  const isDisabled = disabled || isLoading || permissionDenied;
  const label = typeof children === "string" ? children : buttonProps["aria-label"];

  return (
    <button
      ref={ref}
      type={type}
      className={clsx(buttonStyles({ variant, size }), className)}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-label={label}
      {...buttonProps}
    >
      {isLoading
        ? <Loader2 aria-hidden="true" className="sk-icon sk-spin" />
        : Icon
        ? <Icon aria-hidden="true" className="sk-icon" />
        : null}
      {children ? <span>{children}</span> : null}
      {TrailingIcon ? <TrailingIcon aria-hidden="true" className="sk-icon" /> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "size"> {
  readonly label: string;
  readonly icon: LucideIcon;
}

export function IconButton(props: IconButtonProps) {
  const { label, icon, ...buttonProps } = props;

  return <Button aria-label={label} title={label} icon={icon} size="icon" {...buttonProps} />;
}

export interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly helperText?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function Field(props: FieldProps) {
  const helperId = props.helperText ? `${props.id}-helper` : undefined;
  const errorId = props.error ? `${props.id}-error` : undefined;

  return (
    <div className="sk-field">
      <label className="sk-field__label" htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.helperText
        ? <p className="sk-field__helper" id={helperId}>{props.helperText}</p>
        : null}
      {props.error
        ? <p className="sk-field__error" id={errorId} role="alert">{props.error}</p>
        : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly helperText?: string;
  readonly error?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  props,
  ref,
) {
  const { id, label, helperText, error, className, ...inputProps } = props;
  const inputId = id ?? inputProps.name ?? crypto.randomUUID();

  return (
    <Field id={inputId} label={label} helperText={helperText} error={error}>
      <input
        ref={ref}
        id={inputId}
        className={clsx("sk-input", className)}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={clsx(helperText && `${inputId}-helper`, error && `${inputId}-error`) ||
          undefined}
        {...inputProps}
      />
    </Field>
  );
});

export interface TextAreaInputProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label: string;
  readonly helperText?: string;
  readonly error?: string;
}

export const TextAreaInput = forwardRef<HTMLTextAreaElement, TextAreaInputProps>(
  function TextAreaInput(props, ref) {
    const { id, label, helperText, error, className, ...textareaProps } = props;
    const textareaId = id ?? textareaProps.name ?? crypto.randomUUID();

    return (
      <Field id={textareaId} label={label} helperText={helperText} error={error}>
        <textarea
          ref={ref}
          id={textareaId}
          className={clsx("sk-input", "sk-textarea", className)}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={clsx(
            helperText && `${textareaId}-helper`,
            error && `${textareaId}-error`,
          ) || undefined}
          {...textareaProps}
        />
      </Field>
    );
  },
);

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly label: string;
  readonly helperText?: string;
  readonly error?: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
}

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  props,
  ref,
) {
  const { id, label, helperText, error, options, className, ...selectProps } = props;
  const selectId = id ?? selectProps.name ?? crypto.randomUUID();

  return (
    <Field id={selectId} label={label} helperText={helperText} error={error}>
      <select
        ref={ref}
        id={selectId}
        className={clsx("sk-input", "sk-select", className)}
        aria-invalid={error ? "true" : "false"}
        {...selectProps}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
});

export interface CheckboxFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly helperText?: string;
}

export function CheckboxField(props: CheckboxFieldProps) {
  const { id, label, helperText, className, ...inputProps } = props;
  const inputId = id ?? inputProps.name ?? crypto.randomUUID();

  return (
    <label className="sk-checkbox" htmlFor={inputId}>
      <input id={inputId} type="checkbox" className={className} {...inputProps} />
      <span>
        <span className="sk-checkbox__label">{label}</span>
        {helperText ? <span className="sk-checkbox__helper">{helperText}</span> : null}
      </span>
    </label>
  );
}

export function StatusBadge(props: {
  readonly tone?: Tone;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className={clsx("sk-badge", `sk-badge--${props.tone ?? "neutral"}`, props.className)}>
      {props.children}
    </span>
  );
}

export function StatePanel(props: {
  readonly title: string;
  readonly message: string;
  readonly tone?: Tone;
  readonly action?: StateAction;
}) {
  const Icon = getStateIcon(props.tone ?? "neutral");

  return (
    <section
      className={clsx("sk-state", `sk-state--${props.tone ?? "neutral"}`)}
      aria-live="polite"
    >
      <Icon aria-hidden="true" className="sk-state__icon" />
      <div>
        <h2>{props.title}</h2>
        <p>{props.message}</p>
        {props.action
          ? (
            <Button icon={props.action.icon} variant="outline" onClick={props.action.onClick}>
              {props.action.label}
            </Button>
          )
          : null}
      </div>
    </section>
  );
}

export function LoadingState(props: { readonly label?: string }) {
  return (
    <div className="sk-loading" role="status">
      <Loader2 aria-hidden="true" className="sk-icon sk-spin" />
      <span>{props.label ?? "Loading"}</span>
    </div>
  );
}

export function EmptyState(props: { readonly title: string; readonly message: string }) {
  return <StatePanel title={props.title} message={props.message} tone="neutral" />;
}

export function ErrorState(props: {
  readonly title: string;
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <StatePanel
      title={props.title}
      message={props.message}
      tone="danger"
      action={props.onRetry ? { label: "Retry", onClick: props.onRetry } : undefined}
    />
  );
}

export function PermissionDeniedState() {
  return (
    <StatePanel
      title="Permission required"
      message="Your current role cannot access this area."
      tone="warning"
    />
  );
}

export function PermissionGate(props: {
  readonly permission: string;
  readonly fallback?: ReactNode;
  readonly children: ReactNode;
}) {
  const can = usePermissionCheck();

  if (!can(props.permission)) {
    return props.fallback ?? <PermissionDeniedState />;
  }

  return <>{props.children}</>;
}

export function PageShell(props: {
  readonly brand: string;
  readonly navItems: readonly NavItem[];
  readonly activeHref: string;
  readonly userLabel: string;
  readonly contextLabel?: string;
  readonly notificationCount?: number;
  readonly onNavigate: (href: string) => void;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}) {
  const primaryItems = props.navItems.slice(0, 5);
  const secondaryItems = props.navItems.slice(5);

  return (
    <div className="sk-shell">
      <aside className="sk-sidebar" aria-label="Primary">
        <div className="sk-brand">
          <span className="sk-brand__mark" aria-hidden="true">S</span>
          <span className="sk-brand__copy">
            <strong>{props.brand}</strong>
            <small>{props.contextLabel ?? "Operations"}</small>
          </span>
        </div>
        <nav className="sk-nav" aria-label="Workspace">
          <NavGroup
            label="Workspace"
            items={primaryItems}
            activeHref={props.activeHref}
            onNavigate={props.onNavigate}
          />
          {secondaryItems.length > 0
            ? (
              <NavGroup
                label="Controls"
                items={secondaryItems}
                activeHref={props.activeHref}
                onNavigate={props.onNavigate}
              />
            )
            : null}
        </nav>
      </aside>
      <div className="sk-main">
        <header className="sk-topbar">
          <IconButton label="Navigation" icon={Menu} variant="ghost" className="sk-mobile-only" />
          <div className="sk-search">
            <Search aria-hidden="true" className="sk-icon" />
            <input aria-label="Search" placeholder="Search records, actions, or references" />
          </div>
          {props.contextLabel ? <StatusBadge tone="info">{props.contextLabel}</StatusBadge> : null}
          <IconButton
            label="Notifications"
            icon={Bell}
            variant="ghost"
          />
          <div className="sk-account">
            <UserCircle aria-hidden="true" className="sk-icon" />
            <span>{props.userLabel}</span>
          </div>
          <IconButton label="Sign out" icon={LogOut} variant="ghost" onClick={props.onSignOut} />
        </header>
        <main className="sk-content">
          {props.children}
        </main>
        <nav className="sk-bottom-nav" aria-label="Mobile">
          {props.navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx("sk-bottom-nav__item", item.href === props.activeHref && "is-active")}
              onClick={() => props.onNavigate(item.href)}
            >
              {item.icon
                ? <item.icon aria-hidden="true" className="sk-icon" />
                : <Circle className="sk-icon" />}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function NavGroup(props: {
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly activeHref: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="sk-nav__group">
      <p>{props.label}</p>
      {props.items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={clsx("sk-nav__item", item.href === props.activeHref && "is-active")}
          onClick={() => props.onNavigate(item.href)}
        >
          {item.icon
            ? <item.icon aria-hidden="true" className="sk-icon" />
            : <Circle className="sk-icon" />}
          <span>{item.label}</span>
          {item.badge ? <span className="sk-nav__badge">{item.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PageHeader(props: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="sk-page-header">
      <div>
        {props.eyebrow ? <p className="sk-eyebrow">{props.eyebrow}</p> : null}
        <h1>{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.actions ? <div className="sk-page-header__actions">{props.actions}</div> : null}
    </div>
  );
}

export function DataTable<TRecord>(props: {
  readonly caption: string;
  readonly columns: readonly TableColumn<TRecord>[];
  readonly records: readonly TRecord[];
  readonly getRowKey: (record: TRecord) => string;
  readonly isLoading?: boolean;
  readonly emptyTitle?: string;
  readonly emptyMessage?: string;
}) {
  if (props.isLoading) {
    return <LoadingState label="Loading records" />;
  }

  if (props.records.length === 0) {
    return (
      <EmptyState
        title={props.emptyTitle ?? "No records"}
        message={props.emptyMessage ?? "There are no records for the current view."}
      />
    );
  }

  return (
    <div className="sk-table-wrap">
      <table className="sk-table">
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th
                key={column.key}
                style={{ minWidth: column.minWidth }}
                className={`is-${column.align ?? "left"}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.records.map((record) => (
            <tr key={props.getRowKey(record)}>
              {props.columns.map((column) => (
                <td
                  key={column.key}
                  className={`is-${column.align ?? "left"}`}
                  data-label={readColumnLabel(column.header)}
                >
                  {column.render(record)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function readColumnLabel(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return "Value";
}

export function Dialog(props: {
  readonly title: string;
  readonly isOpen: boolean;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
}) {
  if (!props.isOpen) {
    return null;
  }

  return (
    <div className="sk-dialog-backdrop">
      <section
        className="sk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sk-dialog-title"
      >
        <header className="sk-dialog__header">
          <h2 id="sk-dialog-title">{props.title}</h2>
          <IconButton label="Close" icon={X} variant="ghost" onClick={props.onClose} />
        </header>
        <div className="sk-dialog__body">{props.children}</div>
        {props.footer ? <footer className="sk-dialog__footer">{props.footer}</footer> : null}
      </section>
    </div>
  );
}

export function MetricTile(props: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: Tone;
  readonly icon?: LucideIcon;
}) {
  const Icon = props.icon;

  return (
    <section className={clsx("sk-metric", `sk-metric--${props.tone ?? "neutral"}`)}>
      {Icon ? <Icon aria-hidden="true" className="sk-metric__icon" /> : null}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </section>
  );
}

export interface DetailItem {
  readonly label: string;
  readonly value: ReactNode;
}

export function DetailList(props: { readonly items: readonly DetailItem[] }) {
  return (
    <dl className="sk-detail-list">
      {props.items.map((item) => (
        <div key={String(item.label)}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OnboardingChecklist(props: {
  readonly title: string;
  readonly steps: readonly OnboardingStepView[];
  readonly onOpenStep?: (step: OnboardingStepView) => void;
}) {
  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <h2>{props.title}</h2>
      </div>
      <ol className="sk-onboarding">
        {props.steps.map((step) => (
          <li key={step.key} className={`sk-onboarding__step is-${step.status}`}>
            <span className="sk-onboarding__status" aria-hidden="true">
              {step.status === "complete"
                ? <Check className="sk-icon" />
                : <ChevronRight className="sk-icon" />}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
            {step.status !== "locked" && props.onOpenStep
              ? (
                <IconButton
                  label={`Open ${step.title}`}
                  icon={ChevronRight}
                  variant="ghost"
                  onClick={() => props.onOpenStep?.(step)}
                />
              )
              : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WorkflowTimeline(props: {
  readonly events: readonly {
    readonly key: string;
    readonly label: string;
    readonly status: string;
    readonly timestamp?: string;
  }[];
}) {
  return (
    <ol className="sk-timeline">
      {props.events.map((event) => (
        <li key={event.key}>
          <StatusBadge tone={toneFromStatus(event.status)}>{event.status}</StatusBadge>
          <span>{event.label}</span>
          {event.timestamp ? <time dateTime={event.timestamp}>{event.timestamp}</time> : null}
        </li>
      ))}
    </ol>
  );
}

export function MoneyDisplay(props: {
  readonly value: string;
  readonly label?: string;
  readonly tone?: Tone;
}) {
  return (
    <span className={clsx("sk-money", `sk-money--${props.tone ?? "neutral"}`)}>
      {props.label ? <span>{props.label}</span> : null}
      <strong>{props.value}</strong>
    </span>
  );
}

export function ToastViewport(props: {
  readonly messages: readonly {
    readonly id: string;
    readonly tone: Tone;
    readonly title: string;
    readonly message: string;
  }[];
}) {
  return (
    <div className="sk-toasts" aria-live="polite" aria-relevant="additions">
      {props.messages.map((message) => (
        <section key={message.id} className={clsx("sk-toast", `sk-toast--${message.tone}`)}>
          <strong>{message.title}</strong>
          <span>{message.message}</span>
        </section>
      ))}
    </div>
  );
}

function getStateIcon(tone: Tone): LucideIcon {
  if (tone === "danger") return ShieldAlert;
  if (tone === "warning") return AlertCircle;
  if (tone === "success") return Check;
  if (tone === "info") return Info;

  return Circle;
}

function toneFromStatus(status: string): Tone {
  if (/approved|active|complete|success|paid/i.exec(status)) return "success";
  if (/failed|rejected|revoked|danger|error/i.exec(status)) return "danger";
  if (/pending|review|warning|queued/i.exec(status)) return "warning";
  if (/draft|new|info/i.exec(status)) return "info";

  return "neutral";
}
