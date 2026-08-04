import { ArrowLeft, CheckCircle2, LoaderCircle } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { mutationErrorMessage } from "@lpg/shared/api/useGatewayMutation";

export function WorkflowHeader(props: {
  readonly onBack: () => void;
  readonly title: string;
  readonly subtitle?: string;
}) {
  return (
    <header className="workflow-header">
      <button type="button" className="icon-button" aria-label="Go back" onClick={props.onBack}>
        <ArrowLeft aria-hidden="true" />
      </button>
      <div>
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
    </header>
  );
}

export function WorkflowForm(props: {
  readonly children: ReactNode;
  readonly error?: unknown;
  readonly isPending?: boolean;
  readonly notice?: string | null;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly submitLabel: string;
}) {
  return (
    <form className="workflow-form" onSubmit={props.onSubmit}>
      {props.children}
      {props.error ? <p className="form-message is-error" role="alert">{mutationErrorMessage(props.error)}</p> : null}
      {props.notice ? <p className="form-message is-success"><CheckCircle2 aria-hidden="true" />{props.notice}</p> : null}
      <button type="submit" className="primary-button" disabled={props.isPending}>
        {props.isPending ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}
        {props.isPending ? "Processing" : props.submitLabel}
      </button>
    </form>
  );
}

export function RecordField(props: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="record-field">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function EmptyRouteState(props: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly title: string;
}) {
  return (
    <section className="route-empty-state">
      <span>{props.icon}</span>
      <h2>{props.title}</h2>
      <p>{props.message}</p>
    </section>
  );
}
