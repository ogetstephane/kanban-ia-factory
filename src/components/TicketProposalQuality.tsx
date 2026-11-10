import type { TicketProposalQuality as QualityReport } from '../../shared/utils/ticketProposalQuality';

export function TicketProposalQuality({ report }: { report: QualityReport }) {
  return (
    <section aria-label="Ticket proposal checks" className="space-y-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 text-xs text-slate-300">
      <h3 className="font-semibold text-indigo-300">
        {report.status === 'ready-for-review' ? 'Ready for human review' : 'Needs clarification'}
      </h3>
      <p>Structural checks only: required fields, prerequisite consistency, repeated text and declared open decisions.
        This does not verify business completeness, measurable outcomes or source evidence. Review before saving or processing.</p>
      {report.issues.length > 0 && <ul className="list-disc space-y-1 pl-4">
        {report.issues.map((issue, index) => <li key={index}>
          <span className="font-mono">{issue.path || 'proposal'}</span>: {issue.message}
        </li>)}
      </ul>}
    </section>
  );
}
