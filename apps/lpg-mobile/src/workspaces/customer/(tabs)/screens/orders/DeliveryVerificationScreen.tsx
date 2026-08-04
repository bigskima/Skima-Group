import { KeyRound, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useGatewayCommandMutation } from "@lpg/shared/api/useGatewayMutation";
import { createLpgIdempotencyKey, getActionResultId } from "@lpg/shared/api/records";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function DeliveryVerificationScreen(props: CustomerScreenProps) {
  const requestChallenge = useGatewayCommandMutation();
  const verifyChallenge = useGatewayCommandMutation();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const orderId = props.navigation.params.orderId;

  const request = async () => {
    setLocalError(null);
    setNotice(null);
    try {
      if (!orderId) throw new Error("An order is required.");
      const recipientAddress = props.context.user.email;
      if (!recipientAddress) throw new Error("A verified account email is required.");
      const result = await requestChallenge.mutateAsync({
        path: "/lpg/orders/delivery-challenge",
        payload: {
          action: "request",
          channel: "in_app",
          idempotencyKey: createLpgIdempotencyKey("delivery-challenge", orderId),
          lpgOrderId: orderId,
          recipientAddress,
          source: "skima.lpg.mobile",
        },
      });
      const id = getActionResultId(result);
      if (!id) throw new Error("The verification service did not return a challenge identifier.");
      setChallengeId(id);
      setNotice("A verification code was sent to your in-app messages.");
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The verification code could not be requested."));
    }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    try {
      if (!orderId || !challengeId) throw new Error("Request a verification code first.");
      if (code.trim().length < 4) throw new Error("Enter the verification code.");
      await verifyChallenge.mutateAsync({
        path: "/lpg/orders/delivery-challenge",
        payload: {
          action: "verify",
          challengeId,
          code: code.trim(),
          idempotencyKey: createLpgIdempotencyKey("delivery-challenge-verify", challengeId),
          lpgOrderId: orderId,
        },
      });
      setNotice("Delivery challenge verified. The assigned driver can complete delivery.");
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The verification code could not be confirmed."));
    }
  };

  return (
    <>
      <WorkflowHeader title="Delivery Verification" subtitle="Secure OTP confirmation" onBack={props.navigation.goBack} />
      <section className="verification-banner"><ShieldCheck aria-hidden="true" /><div><strong>Customer Verification</strong><span>The backend binds this challenge to your order and account.</span></div></section>
      {!challengeId ? (
        <>
          {localError ?? requestChallenge.error ? <p className="form-message is-error">{(localError ?? requestChallenge.error)?.message}</p> : null}
          <button type="button" className="primary-button" disabled={requestChallenge.isPending} onClick={() => void request()}><KeyRound aria-hidden="true" />Request Code</button>
        </>
      ) : (
        <WorkflowForm error={localError ?? verifyChallenge.error} isPending={verifyChallenge.isPending} notice={notice} onSubmit={(event) => void verify(event)} submitLabel="Verify Delivery Code">
          <label>Verification code<input value={code} inputMode="numeric" autoComplete="one-time-code" onChange={(event) => setCode(event.currentTarget.value)} required /></label>
        </WorkflowForm>
      )}
    </>
  );
}
