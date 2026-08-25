export type RecoveryStepState = 'pending' | 'active' | 'passed' | 'failed';

export function RecoveryProgress({ steps }: { steps: Array<{ label: string; state: RecoveryStepState; detail?: string }> }) {
  return <ol className="recovery-progress" aria-label="Recovery progress">
    {steps.map((step, index) => <li key={step.label} className={`recovery-step ${step.state}`}>
      <span className="recovery-marker" aria-hidden="true">{step.state === 'passed' ? '✓' : step.state === 'failed' ? '!' : index + 1}</span>
      <div><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</div>
    </li>)}
  </ol>;
}
