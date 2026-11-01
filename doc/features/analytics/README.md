# Analytics

## Purpose

Velocity & Trends is a dashboard derived from the selected board's ticket data. It presents
throughput, cumulative flow, stage dwell and workflow bottleneck indicators.

## How to open

Choose **Velocity & Trends** in the top navigation. It follows the selected project or
**Show all** scope. Use the feature selector to narrow the dashboard.

## What you can do

- Review KPI cards for sprint velocity, average cycle time, work-in-progress load and the
  primary detected bottleneck.
- Inspect velocity trends, cumulative-flow and stage dwell charts.
- Select a feature/epic filter and open the Workflow Advisor for suggested next steps.

Metrics are calculated client-side; there is no dedicated analytics endpoint. Interpret the
charts as illustrative rather than a historical telemetry report: the earlier sprint/flow points
are fixed sample data, current points use board counts/points, and dwell figures are fixed or
formula-based on current story points and stage counts rather than measured timestamps. The
feature selector affects velocity trends, while flow and dwell calculations use all loaded tasks. Analytics shares the
feature bar and header filters with Board.

## API

- Board input: `GET /api/board/projects/:id/board` or `GET /api/board/board`.
- Advisor actions are described in [Features](../features/README.md) and
  [Tickets](../tickets/README.md).

## Source files

- [VelocityDashboard.tsx](../../../src/components/VelocityDashboard.tsx)
- [velocityMetrics.ts](../../../src/utils/velocityMetrics.ts)
- [App.tsx](../../../src/App.tsx)
- [board.ts route](../../../server/routes/board.ts)

## Related features

[Board](../board/README.md) · [Features and epics](../features/README.md) ·
[Tickets](../tickets/README.md)
