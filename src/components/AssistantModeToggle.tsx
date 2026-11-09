import { useId } from 'react';
import type { AssistantMode } from '../../shared/types/assistantMode';

const options: { mode: AssistantMode; label: string; help: string }[] = [
  { mode: 'auto', label: 'Auto', help: 'Copilot answers directly and proposes a plan only when the request needs one.' },
  { mode: 'plan', label: 'Plan', help: 'Copilot always proposes an editable plan first; you confirm it before the final content.' },
];

/** Auto / Plan selector shared by the Copilot ticket and wiki assistants. */
export function AssistantModeToggle({ mode, onChange, disabled = false }: {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Copilot assistant mode" className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-xs">
      {options.map((option) => (
        <label key={option.mode} title={option.help}
          className={`cursor-pointer rounded-md px-2.5 py-1 font-medium transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${
            mode === option.mode ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
          }`}>
          <input type="radio" name={name} value={option.mode} checked={mode === option.mode} disabled={disabled}
            onChange={() => onChange(option.mode)} className="sr-only" />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function assistantModeHelp(mode: AssistantMode) {
  return options.find((option) => option.mode === mode)!.help;
}
