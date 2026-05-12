import { Factory } from 'lucide-react';

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="SPF Prompt Factory">
      <span className="brand-icon">
        <Factory size={18} strokeWidth={2.2} />
      </span>
      <span>
        <span className="brand-strong">SPF</span> Prompt Factory
      </span>
    </a>
  );
}
