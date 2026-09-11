import { ArrowLeft, ArrowRight } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { Button } from "@skima/ui";

import "./admin-v2-patterns.css";

export function AdminV2PageHeader(props: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="admin-v2-page-header">
      <div className="admin-v2-page-header__copy">
        {props.eyebrow ? <small className="admin-v2-page-header__eyebrow">{props.eyebrow}</small> : null}
        <h1>{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.actions ? <div className="admin-v2-page-header__actions">{props.actions}</div> : null}
    </header>
  );
}

export interface AdminTaskFlowStep {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
}

export function AdminTaskFlow(props: {
  readonly steps: readonly AdminTaskFlowStep[];
  readonly activeStep: string;
  readonly onStepChange: (step: string) => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly previousLabel?: string;
  readonly nextLabel?: string;
  readonly disablePrevious?: boolean;
  readonly disableNext?: boolean;
}) {
  const activeIndex = useMemo(
    () => Math.max(0, props.steps.findIndex((step) => step.key === props.activeStep)),
    [props.activeStep, props.steps],
  );
  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex < props.steps.length - 1;

  return (
    <div className="admin-v2-task-flow">
      <nav className="admin-v2-task-flow__steps" aria-label="Task steps">
        {props.steps.map((step, index) => {
          const active = step.key === props.activeStep;
          return (
            <button
              key={step.key}
              type="button"
              className={`admin-v2-task-flow__step ${active ? "is-active" : ""}`}
              aria-current={active ? "step" : undefined}
              onClick={() => props.onStepChange(step.key)}
            >
              <span className="admin-v2-task-flow__step-index">{index + 1}</span>
              <span>
                <strong>{step.label}</strong>
                {step.description ? <small>{step.description}</small> : null}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="admin-v2-task-flow__body">{props.children}</div>

      <div className="admin-v2-task-flow__footer">
        <div className="admin-v2-task-flow__footer-group">
          <Button
            type="button"
            variant="outline"
            icon={ArrowLeft}
            disabled={!hasPrevious || props.disablePrevious}
            onClick={() => hasPrevious && props.onStepChange(props.steps[activeIndex - 1].key)}
          >
            {props.previousLabel ?? "Back"}
          </Button>
          {hasNext ? (
            <Button
              type="button"
              icon={ArrowRight}
              disabled={props.disableNext}
              onClick={() => props.onStepChange(props.steps[activeIndex + 1].key)}
            >
              {props.nextLabel ?? "Continue"}
            </Button>
          ) : null}
        </div>
        {props.footer ? <div className="admin-v2-task-flow__footer-group">{props.footer}</div> : null}
      </div>
    </div>
  );
}

export function AdminFormSection(props: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="admin-v2-form-section">
      <header className="admin-v2-form-section__heading">
        <h3>{props.title}</h3>
        {props.description ? <p>{props.description}</p> : null}
      </header>
      {props.children}
    </section>
  );
}
